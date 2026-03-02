import { useCallback, useState } from "react";
import { getFileBinary, getFileContent, listFiles, uploadOutputPdf } from "../api/client";
import type { CompileStatus } from "../types";

const DAEMON_URL = import.meta.env.VITE_DAEMON_URL ?? "http://127.0.0.1:7878";

function isBinary(name: string): boolean {
  return /\.(png|jpe?g|gif|pdf|eps|svg|tiff?|bmp|webp)$/i.test(name);
}

/**
 * Converts an ArrayBuffer to a Base64 string in chunks to avoid stack overflows.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export function useCompile(projectId: string | null) {
  const [status, setStatus] = useState<CompileStatus>("idle");
  const [errorLog, setErrorLog] = useState<string | null>(null);

  const compile = useCallback(async () => {
    if (!projectId) return;

    setStatus("compiling");
    setErrorLog(null);

    try {
      // 1. Fetch all project files from R2
      const files = await listFiles(projectId);

      const assets: Record<string, string> = {};
      let mainTex = "";

      await Promise.all(
        files.map(async (file) => {
          if (file.type === "pdf") return; // skip compiled output
          if (file.type === "tex" && file.name === "main.tex") {
            mainTex = await getFileContent(projectId, file.name);
          } else if (isBinary(file.name)) {
            const buf = await getFileBinary(projectId, file.name);
            assets[file.name] = arrayBufferToBase64(buf);
          } else {
            assets[file.name] = await getFileContent(projectId, file.name);
          }
        }),
      );

      // Fall back to first .tex if no main.tex
      if (!mainTex) {
        const firstTex = files.find((f) => f.type === "tex");
        if (firstTex) {
          mainTex = await getFileContent(projectId, firstTex.name);
        }
      }

      // 2. POST bundle to local daemon
      const daemonRes = await fetch(`${DAEMON_URL}/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainTex, assets }),
      });

      if (daemonRes.ok) {
        // 3. Upload PDF back to Worker
        const pdfBytes = await daemonRes.arrayBuffer();
        await uploadOutputPdf(projectId, pdfBytes);
        setStatus("success");
      } else {
        const errBody = await daemonRes.json() as { error: string; log: string };
        setErrorLog(errBody.log ?? "Compilation failed");
        setStatus("error");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Provide helpful message if daemon is not running
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setErrorLog(
          `Cannot reach daemon at ${DAEMON_URL}/compile.\n\nMake sure the daemon is running:\n  cd daemon && cargo run`,
        );
      } else {
        setErrorLog(msg);
      }
      setStatus("error");
    }
  }, [projectId]);

  return { status, errorLog, compile };
}
