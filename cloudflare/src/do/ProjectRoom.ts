/**
 * ProjectRoom — Durable Object for real-time coordination per project.
 *
 * One instance per active project (keyed by project ID).
 *
 * Uses the WebSocket Hibernation API so the DO sleeps between messages and
 * is only billed for actual CPU time, not idle connection time.
 *
 * Endpoints (internal Worker → DO):
 *   GET  /ws        — WebSocket upgrade
 *   POST /broadcast — JSON body forwarded to all connected clients
 *
 * WebSocket message types relayed:
 *   string      — JSON event notifications (e.g. { event: "pdf_updated" })
 *   ArrayBuffer — Yjs CRDT binary updates (editor collaboration)
 */
export class ProjectRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/ws") {
      return this.handleWebSocket(request);
    }

    if (pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcast(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocket(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();

    // Hibernation API: DO sleeps between messages instead of staying hot.
    // - No event listeners or sessions Set needed; runtime manages both.
    // - getWebSockets() returns live connections after each wakeup.
    // - Connections survive eviction/hibernation transparently.
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    const msg = JSON.stringify(await request.json());
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // Socket already gone — runtime removes it from getWebSockets() automatically.
      }
    }
    return new Response(null, { status: 204 });
  }

  // ── Hibernation event handlers ────────────────────────────────────────────
  // The runtime calls these methods after waking the DO for each WS event.
  // No manual session tracking required.

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    for (const other of this.state.getWebSockets()) {
      if (other !== ws) {
        try {
          other.send(message);
        } catch {
          // Already closed — no cleanup needed.
        }
      }
    }
  }

  webSocketClose(): void {
    // Runtime removes the socket from getWebSockets() automatically.
  }

  webSocketError(): void {
    // Same — no manual cleanup required.
  }
}
