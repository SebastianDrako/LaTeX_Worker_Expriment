import { useEffect, useRef } from "react";
import { wsUrl } from "../api/client";
import { RobustWebSocket } from "../api/websocket";

/**
 * Opens a WebSocket to the project room using the RobustWebSocket client
 * and calls `onPdfUpdated` whenever the server broadcasts { event: "pdf_updated" }.
 *
 * The RobustWebSocket handles reconnection logic automatically.
 */
export function usePdfReload(
  projectId: string | null,
  onPdfUpdated: () => void,
) {
  const cbRef = useRef(onPdfUpdated);
  cbRef.current = onPdfUpdated;

  useEffect(() => {
    if (!projectId) return;

    const ws = new RobustWebSocket(wsUrl(projectId));

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as { event: string };
          if (msg.event === "pdf_updated") {
            cbRef.current();
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
