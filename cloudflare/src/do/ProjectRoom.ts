/**
 * ProjectRoom — Durable Object for real-time coordination per project.
 *
 * One instance per active project (keyed by project ID).
 *
 * Endpoints (internal Worker → DO):
 *   GET  /ws        — WebSocket upgrade; adds client to the broadcast set
 *   POST /broadcast — JSON body is forwarded to all connected clients
 */
export class ProjectRoom implements DurableObject {
  private readonly sessions = new Set<WebSocket>();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_state: DurableObjectState) {}

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
    server.accept();

    this.sessions.add(server);
    server.addEventListener("close", () => this.sessions.delete(server));
    server.addEventListener("error", () => this.sessions.delete(server));

    // Relay any message sent by a client to all other clients.
    // Supports both text (JSON notifications) and binary (Yjs CRDT updates).
    server.addEventListener("message", (event) => {
      for (const other of this.sessions) {
        if (other !== server) {
          try {
            other.send(event.data as string | ArrayBuffer);
          } catch {
            this.sessions.delete(other);
          }
        }
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    const msg = JSON.stringify(await request.json());
    for (const ws of this.sessions) {
      try {
        ws.send(msg);
      } catch {
        this.sessions.delete(ws);
      }
    }
    return new Response(null, { status: 204 });
  }
}
