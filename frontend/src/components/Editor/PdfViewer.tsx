import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import { getOutputPdf } from "../../api/client";

// Point pdfjs at the bundled worker via Vite's URL import
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface Props {
  projectId: string;
  projectName: string;
  reloadSignal: number; // increment to trigger a reload
}

export function PdfViewer({ projectId, projectName, reloadSignal }: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const buf = await getOutputPdf(projectId);
      pdfBytesRef.current = buf;
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    } catch (e) {
      if (e instanceof Error && e.message.includes("404")) {
        // No PDF yet — not an error, just waiting for first compile
        setPdfDoc(null);
        pdfBytesRef.current = null;
      } else {
        setError(e instanceof Error ? e.message : "Failed to load PDF");
      }
    }
  }, [projectId]);

  const handleDownload = useCallback(() => {
    if (!pdfBytesRef.current) return;
    const blob = new Blob([pdfBytesRef.current], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [projectName]);

  // Load on mount and whenever reloadSignal changes
  useEffect(() => {
    void load();
  }, [load, reloadSignal]);

  // Lazy-render pages as they scroll into view.
  // Pre-create all canvases (with placeholder height) so the scrollbar reflects
  // the full document length, then render each page on first intersection.
  useEffect(() => {
    if (!pdfDoc || !containerRef.current || !scrollRef.current) return;

    const container = containerRef.current;
    const scrollEl = scrollRef.current;
    container.innerHTML = "";

    const pageCount = pdfDoc.numPages;
    const canvases: HTMLCanvasElement[] = [];
    const rendered = new Set<number>();

    // Pre-fetch page 1 to get the viewport dimensions for placeholders.
    let placeholderH = 800;
    let placeholderW = 566;

    const setup = async () => {
      const p1 = await pdfDoc.getPage(1);
      const vp = p1.getViewport({ scale: 1.5 });
      placeholderH = vp.height;
      placeholderW = vp.width;

      for (let i = 0; i < pageCount; i++) {
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";
        canvas.dataset.pageIdx = String(i);
        // Set placeholder dimensions so the scroll container has the right size.
        canvas.width = placeholderW;
        canvas.height = placeholderH;
        container.appendChild(canvas);
        canvases.push(canvas);
      }

      const renderPage = async (idx: number, page: PDFPageProxy) => {
        const viewport = page.getViewport({ scale: 1.5 });
        canvases[idx].width = viewport.width;
        canvases[idx].height = viewport.height;
        const ctx = canvases[idx].getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
      };

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const idx = parseInt((entry.target as HTMLCanvasElement).dataset.pageIdx ?? "-1");
            if (idx < 0 || rendered.has(idx)) return;
            rendered.add(idx);
            void pdfDoc.getPage(idx + 1).then((page) => renderPage(idx, page));
          });
        },
        // 300 px lookahead so pages render before the user actually reaches them.
        { root: scrollEl, rootMargin: "400px" },
      );

      canvases.forEach((canvas) => observer.observe(canvas));

      return () => observer.disconnect();
    };

    let cleanup: (() => void) | undefined;
    void setup().then((fn) => { cleanup = fn; });

    return () => { cleanup?.(); };
  }, [pdfDoc]);

  return (
    <div className="pdf-panel">
      <div className="pdf-panel-header">
        <span>PDF Preview</span>
        {numPages > 0 && (
          <span style={{ marginLeft: "auto" }}>{numPages} page{numPages !== 1 ? "s" : ""}</span>
        )}
        {pdfBytesRef.current && (
          <button
            className="icon-btn"
            title="Download PDF"
            onClick={handleDownload}
            style={{ marginLeft: numPages > 0 ? 8 : "auto" }}
          >
            ↓
          </button>
        )}
      </div>

      <div className="pdf-scroll" ref={scrollRef}>
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
        <div ref={containerRef} className="pdf-pages-container" />
      </div>
    </div>
  );
}
