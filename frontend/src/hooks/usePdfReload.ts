import { useEffect, useRef } from "react";
import { wsUrl } from "../api/client";
import { RobustWebSocket } from "../api/websocket";

/**
 * Opens a WebSocket to the project room using the RobustWebSocket client
 * and dispatches JSON event notifications to the appropriate callbacks.
 *
 * Handled events:
 *   { event: "pdf_updated" }   → calls onPdfUpdated
 *   { event: "files_updated" } → calls onFilesUpdated (if provided)
 */
export function usePdfReload(
  projectId: string | null,
  onPdfUpdated: () => void,
  onFilesUpdated?: () => void,
) {
  const pdfCbRef = useRef(onPdfUpdated);
  pdfCbRef.current = onPdfUpdated;

  const filesCbRef = useRef(onFilesUpdated);
  filesCbRef.current = onFilesUpdated;

  useEffect(() => {
    if (!projectId) return;

    const ws = new RobustWebSocket(wsUrl(projectId));

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as { event: string };
          if (msg.event === "pdf_updated") {
            pdfCbRef.current();
          } else if (msg.event === "files_updated") {
            filesCbRef.current?.();
          }
        } catch {
          // ignore malformed messages
        }
      }
    };

    return () => {
      ws.close();
    };
  }, [projectId]);
}
