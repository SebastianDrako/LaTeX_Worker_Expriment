import { useEffect, useRef } from "react";
import { wsUrl } from "../api/client";

/**
 * Opens a WebSocket to the project room and calls `onPdfUpdated` whenever
 * the server broadcasts { event: "pdf_updated" }.
 *
 * Binary messages are relayed as-is (used by Yjs in the editor).
 * Text messages are parsed as JSON notifications.
 */
export function usePdfReload(
  projectId: string | null,
  onPdfUpdated: () => void,
) {
  const cbRef = useRef(onPdfUpdated);
  cbRef.current = onPdfUpdated;

  useEffect(() => {
    if (!projectId) return;

    let ws: WebSocket;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(wsUrl(projectId));

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data) as { event: string };
            if (msg.event === "pdf_updated") cbRef.current();
          } catch {
            // ignore malformed messages
          }
        }
        // binary messages handled by Yjs — nothing to do here
      };

      ws.onclose = () => {
        if (!closed) {
          // Reconnect after 3s
          setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closed = true;
      ws?.close();
    };
  }, [projectId]);
}
