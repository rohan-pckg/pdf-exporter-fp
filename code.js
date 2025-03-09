figma.showUI(__html__, { width: 400, height: 500 });

// Track selection order globally
let selectionOrderMap = new Map();
let selectionCounter = 0;

// Function to update selection order map
async function updateSelectionOrder(selection) {
  // Get currently selected frames
  const selectedFrames = selection.filter((node) => node.type === "FRAME");

  // Get the set of currently selected frame IDs
  const selectedIds = new Set(selectedFrames.map((frame) => frame.id));

  // If nothing is selected, reset tracking
  if (selectedFrames.length === 0) {
    selectionOrderMap.clear();
    selectionCounter = 0;
    figma.ui.postMessage({
      type: "selection-count",
      count: 0,
      selectionOrder: [],
    });
    return;
  }

  // Remove frames that are no longer selected
  for (const [id, _] of selectionOrderMap) {
    if (!selectedIds.has(id)) {
      selectionOrderMap.delete(id);
    }
  }

  // Check if we have a brand new selection (all frames not in our map)
  const isNewBatchSelection =
    selectedFrames.every((frame) => !selectionOrderMap.has(frame.id)) &&
    selectedFrames.length > 1;

  // For a new batch selection, sort spatially first
  if (isNewBatchSelection) {
    // Sort spatially (top to bottom, left to right)
    const sortedFrames = [...selectedFrames].sort((a, b) => {
      // First sort by Y position (top to bottom)
      if (Math.abs(a.y - b.y) > 50) {
        return a.y - b.y;
      }
      // If Y positions are similar, sort by X position (left to right)
      return a.x - b.x;
    });

    // Clear the map for a fresh start with this batch
    selectionOrderMap.clear();
    selectionCounter = 0;

    // Add the sorted frames to the map
    sortedFrames.forEach((frame) => {
      selectionOrderMap.set(frame.id, selectionCounter++);
    });

    console.log("New batch selection auto-sequenced spatially");
  } else {
    // For individual new selections, add them to the map with the next counter value
    selectedFrames.forEach((frame) => {
      if (!selectionOrderMap.has(frame.id)) {
        selectionOrderMap.set(frame.id, selectionCounter++);
      }
    });
  }

  // Create selection info array
  const selectionInfo = Array.from(selectionOrderMap.entries()).map(
    ([id, order]) => {
      // Find the frame in the current selection
      const frame = selectedFrames.find((f) => f.id === id);
      return {
        id,
        order,
        name: frame ? frame.name : "Unknown",
      };
    },
  );

  // Sort the selection info by order
  selectionInfo.sort((a, b) => a.order - b.order);

  // Send updated selection info to the UI
  figma.ui.postMessage({
    type: "selection-count",
    count: selectedFrames.length,
    selectionOrder: selectionInfo,
  });

  console.log(
    "Updated selection order:",
    selectionInfo.map((info) => `${info.name} (${info.order})`),
  );
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "generate-pdf") {
    const { suffix, colorProfile, quality, resampling, sortOrder } = msg;

    // Get selected frames only
    let selectedFrames = figma.currentPage.selection.filter(
      (node) => node.type === "FRAME",
    );

    console.log(
      `Selected frames (before sorting):`,
      selectedFrames.map((f) => f.name),
    );

    if (selectedFrames.length === 0) {
      figma.ui.postMessage({
        type: "error",
        message: "Please select at least one frame to export",
      });
      return;
    }

    // Sort frames based on the selected sort order
    if (sortOrder === "position") {
      // Sort by position (top to bottom, left to right)
      selectedFrames = selectedFrames.sort((a, b) => {
        // First sort by Y position (top to bottom)
        if (Math.abs(a.y - b.y) > 50) {
          return a.y - b.y;
        }
        // If Y positions are similar, sort by X position (left to right)
        return a.x - b.x;
      });
    } else if (sortOrder === "name") {
      // Sort alphabetically by name
      selectedFrames = selectedFrames.sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } else if (sortOrder === "selection") {
      // Sort by the selection order we've been tracking
      selectedFrames = selectedFrames.sort((a, b) => {
        const orderA = selectionOrderMap.has(a.id)
          ? selectionOrderMap.get(a.id)
          : 0;
        const orderB = selectionOrderMap.has(b.id)
          ? selectionOrderMap.get(b.id)
          : 0;
        return orderA - orderB;
      });
    }

    console.log(
      `Selected frames (after sorting by ${sortOrder}):`,
      selectedFrames.map((f) => [
        f.name,
        selectionOrderMap.has(f.id) ? selectionOrderMap.get(f.id) : 0,
      ]),
    );

    try {
      figma.ui.postMessage({
        type: "export-started",
        count: selectedFrames.length,
      });

      let pdfBuffers = [];

      for (let i = 0; i < selectedFrames.length; i++) {
        const frame = selectedFrames[i];
        const fileName = suffix ? `${frame.name}_${suffix}` : frame.name;

        figma.ui.postMessage({
          type: "export-progress",
          current: i + 1,
          total: selectedFrames.length,
          frameName: frame.name,
        });

        try {
          const selectionIdx = selectionOrderMap.has(frame.id)
            ? selectionOrderMap.get(frame.id)
            : "unknown";
          console.log(
            `Exporting frame: ${frame.name} (position: X=${frame.x}, Y=${frame.y}, selection order: ${selectionIdx})`,
          );

          // Ensure it's a valid frame before exporting
          if (frame.type !== "FRAME") {
            throw new Error(`Invalid selection: ${frame.name} is not a frame.`);
          }

          // Export with quality settings
          const bytes = await frame.exportAsync({ format: "PDF" });

          if (!bytes || bytes.length === 0) {
            throw new Error(
              `Export failed: ${frame.name} returned empty PDF data.`,
            );
          }

          console.log(
            `Export successful: ${fileName}.pdf (${bytes.length} bytes)`,
          );

          pdfBuffers.push({
            id: frame.id,
            name: frame.name,
            suffix: suffix,
            bytes: Array.from(bytes),
            position: { x: frame.x, y: frame.y },
            selectionOrder: selectionOrderMap.has(frame.id)
              ? selectionOrderMap.get(frame.id)
              : 0,
          });
        } catch (exportError) {
          console.error(`Export error for ${frame.name}:`, exportError);

          // Try exporting as PNG if PDF fails
          try {
            console.warn(`Attempting PNG export for ${frame.name}...`);
            const pngBytes = await frame.exportAsync({ format: "PNG" });

            if (pngBytes && pngBytes.length > 0) {
              console.log(
                `PNG export successful for ${frame.name}, Size: ${pngBytes.length} bytes`,
              );
            } else {
              console.error(`PNG export also failed for ${frame.name}.`);
            }
          } catch (pngError) {
            console.error(`PNG export error for ${frame.name}:`, pngError);
          }

          figma.ui.postMessage({
            type: "error",
            message: `Error exporting "${frame.name}": ${exportError.message || "Unknown error"}`,
          });
        }
      }

      // Merge or return exported PDFs
      if (pdfBuffers.length > 1) {
        figma.ui.postMessage({
          type: "merge-pdfs",
          pdfData: pdfBuffers,
          fileName: `Merged_Document.pdf`,
          qualitySettings: { colorProfile, quality, resampling },
        });
      } else if (pdfBuffers.length === 1) {
        // Fixed: Include suffix in filename and send proper format for single PDF
        const fileName = `${pdfBuffers[0].name}${suffix ? "_" + suffix : ""}.pdf`;
        figma.ui.postMessage({
          type: "export-single-pdf",
          fileName: fileName,
          bytes: pdfBuffers[0].bytes,
        });
      } else {
        figma.ui.postMessage({
          type: "error",
          message: "No PDFs were successfully exported",
        });
      }
    } catch (error) {
      console.error("General export error:", error);
      figma.ui.postMessage({
        type: "error",
        message: `Error exporting PDFs: ${error.message}`,
      });
    }
  }
};

// Initial selection check
updateSelectionOrder(figma.currentPage.selection);

// Selection listener to update UI & debug selection
figma.on("selectionchange", () => {
  updateSelectionOrder(figma.currentPage.selection);
});
