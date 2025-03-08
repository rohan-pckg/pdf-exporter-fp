// Show the UI
figma.showUI(__html__, { width: 400, height: 500 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "generate-pdf") {
    const { suffix } = msg;

    // Get selected frames only
    const selectedFrames = figma.currentPage.selection.filter(
      (node) => node.type === "FRAME"
    );

    console.log(`Selected frames:`, selectedFrames.map(f => f.name)); // Debugging log

    if (selectedFrames.length === 0) {
      figma.ui.postMessage({
        type: "error",
        message: "Please select at least one frame to export",
      });
      return;
    }

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
          console.log(`Exporting frame: ${frame.name}`);

          // Ensure it's a valid frame before exporting
          if (frame.type !== "FRAME") {
            throw new Error(`Invalid selection: ${frame.name} is not a frame.`);
          }

          // ✅ FIXED: Removed `constraint`
          const bytes = await frame.exportAsync({ format: "PDF" });

          if (!bytes || bytes.length === 0) {
            throw new Error(`Export failed: ${frame.name} returned empty PDF data.`);
          }

          console.log(`Export successful: ${fileName}.pdf (${bytes.length} bytes)`);
          pdfBuffers.push(Array.from(bytes));

        } catch (exportError) {
          console.error(`Export error for ${frame.name}:`, exportError);

          // Try exporting as PNG if PDF fails
          try {
            console.warn(`Attempting PNG export for ${frame.name}...`);
            const pngBytes = await frame.exportAsync({ format: "PNG" });

            if (pngBytes && pngBytes.length > 0) {
              console.log(`PNG export successful for ${frame.name}, Size: ${pngBytes.length} bytes`);
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
          bytesArray: pdfBuffers,
          fileName: `Merged_Document.pdf`,
        });
      } else if (pdfBuffers.length === 1) {
        figma.ui.postMessage({
          type: "export-bytes",
          fileName: `${selectedFrames[0].name}.pdf`,
          bytes: pdfBuffers[0],
        });
      } else {
        figma.ui.postMessage({
          type: "error",
          message: "No PDFs were successfully exported",
        });
      }
    } catch (error) {
      console.error("General export error:", error);
      figma.ui.postMessage({ type: "error", message: `Error exporting PDFs: ${error.message}` });
    }
  }
};

// Selection listener to update UI & debug selection
figma.on("selectionchange", () => {
  const selectedFrames = figma.currentPage.selection.filter(
    (node) => node.type === "FRAME"
  );

  console.log("Updated selection:", selectedFrames.map(f => f.name)); // Debugging log
  figma.ui.postMessage({ type: "selection-count", count: selectedFrames.length });
});
