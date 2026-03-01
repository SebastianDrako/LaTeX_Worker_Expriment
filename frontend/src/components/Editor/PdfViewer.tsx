import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import { getOutputPdf } from "../../api/client";

// Point pdfjs at the bundled worker via Vite's URL import
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface Props {
  projectId: string;
  reloadSignal: number; // increment to trigger a reload
}

export function PdfViewer({ projectId, reloadSignal }: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderingRef = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const buf = await getOutputPdf(projectId);
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    } catch (e) {
      if (e instanceof Error && e.message.includes("404")) {
        // No PDF yet — not an error, just waiting for first compile
        setPdfDoc(null);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load PDF");
      }
    }
  }, [projectId]);

  // Load on mount and whenever reloadSignal changes
  useEffect(() => {
    void load();
  }, [load, reloadSignal]);

  // Render all pages whenever pdfDoc changes
  useEffect(() => {
    if (!pdfDoc || !containerRef.current || renderingRef.current) return;

    const container = containerRef.current;
    container.innerHTML = "";
    renderingRef.current = true;

    const renderAll = async () => {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        container.appendChild(canvas);

        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
      renderingRef.current = false;
    };

    void renderAll();
  }, [pdfDoc]);

  return (
    <div className="pdf-panel">
      <div className="pdf-panel-header">
        <span>PDF Preview</span>
        {numPages > 0 && (
          <span style={{ marginLeft: "auto" }}>{numPages} page{numPages !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div className="pdf-scroll">
        {error && (
          <p className="pdf-placeholder" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}
        {!pdfDoc && !error && (
          <p className="pdf-placeholder">
            Compile your project to see the PDF here.
          </p>
        )}
        <div ref={containerRef} style={{ display: "contents" }} />
      </div>
    </div>
  );
}
