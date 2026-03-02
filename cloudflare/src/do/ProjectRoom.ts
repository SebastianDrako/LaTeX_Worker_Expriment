/**
 * ProjectRoom — Durable Object for real-time coordination per project.
 *
 * One instance per active project (keyed by project ID).
 *
 * Uses the WebSocket Hibernation API so the DO sleeps between messages and
 * is only billed for actual CPU time, not idle connection time.
 *
 * Endpoints (internal Worker → DO):
 *   GET  /ws        — WebSocket upgrade (?project=<id>&file=<name>)
 *   POST /broadcast — JSON body forwarded to all connected clients
 *
 * WebSocket message types:
 *   string      — JSON event notifications (e.g. { event: "pdf_updated" })
 *                 relayed to ALL connected clients regardless of file.
 *   ArrayBuffer — Yjs CRDT binary updates (editor collaboration).
 *                 Applied to the DO's in-memory Y.Doc for that file,
 *                 then relayed only to clients editing the same file.
 *
 * Snapshot persistence:
 *   The DO maintains a Y.Doc per file in memory (lost on hibernation).
 *   After applying every SAVE_EVERY binary updates — or when the last
 *   client for a given file disconnects — the full CRDT state is written
 *   to R2 so new clients can bootstrap from it instead of plain text.
 */
import * as Y from "yjs";
import { yjsSnapshotKey } from "../storage";

interface Env {
  STORAGE: R2Bucket;
}

interface WsAttachment {
  projectId: string;
  fileName: string;
}

/** Save snapshot to R2 every N binary Yjs updates per file. */
const SAVE_EVERY = 5;

export class ProjectRoom implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  /**
   * In-memory Y.Docs keyed by fileName.
   * Lost when the DO hibernates — lazily reloaded from R2 on next message.
   */
  private ydocs = new Map<string, Y.Doc>();
  /** Caches the loading promise to prevent race conditions on first load. */
  private ydocPromises = new Map<string, Promise<Y.Doc>>();
  /** Counts binary updates per file since last snapshot save. */
  private updateCounts = new Map<string, number>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/ws") {
      return this.handleWebSocket(request, url);
    }

    if (pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcast(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocket(request: Request, url: URL): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const projectId = url.searchParams.get("project") ?? "";
    const fileName = url.searchParams.get("file") ?? "main.tex";

    const { 0: client, 1: server } = new WebSocketPair();

    // Hibernation API: DO sleeps between messages instead of staying hot.
    this.state.acceptWebSocket(server);

    // Persist file context across hibernation cycles.
    server.serializeAttachment({ projectId, fileName } satisfies WsAttachment);

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
  // The runtime awaits these after waking the DO for each WS event.

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") {
      // JSON notification (e.g. pdf_updated) — relay to all other clients.
      for (const other of this.state.getWebSockets()) {
        if (other !== ws) {
          try { other.send(message); } catch { /* already closed */ }
        }
      }
      return;
    }

    // Binary = Yjs CRDT update for a specific file.
    const { projectId, fileName } = ws.deserializeAttachment() as WsAttachment;

    // Apply to our in-memory Y.Doc (lazy-loaded from R2 snapshot if needed).
    const ydoc = await this.getOrLoadYdoc(projectId, fileName);
    Y.applyUpdate(ydoc, new Uint8Array(message));

    // Relay only to other clients editing the same file.
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const att = other.deserializeAttachment() as WsAttachment;
      if (att.projectId === projectId && att.fileName === fileName) {
        try { other.send(message); } catch { /* already closed */ }
      }
    }

    // Throttled snapshot save.
    const count = (this.updateCounts.get(fileName) ?? 0) + 1;
    this.updateCounts.set(fileName, count);
    if (count % SAVE_EVERY === 0) {
      await this.saveSnapshot(projectId, fileName, ydoc);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const { projectId, fileName } = ws.deserializeAttachment() as WsAttachment;

    // After close, runtime already removed ws from getWebSockets().
    // If no other clients are editing this file, persist the final snapshot
    // and clear the in-memory doc to allow it to be reloaded from R2 later.
    const stillEditing = this.state.getWebSockets().some((s) => {
      const att = s.deserializeAttachment() as WsAttachment;
      return att.projectId === projectId && att.fileName === fileName;
    });

    if (!stillEditing) {
      const ydoc = this.ydocs.get(fileName);
      if (ydoc) {
        await this.saveSnapshot(projectId, fileName, ydoc);
      }
      // Clean up memory for this file
      this.ydocs.delete(fileName);
      this.ydocPromises.delete(fileName);
      this.updateCounts.delete(fileName);
    }
  }

  webSocketError(): void {
    // Runtime removes the socket automatically — no manual cleanup needed.
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Returns the in-memory Y.Doc for a file, loading from the R2 snapshot
   * if not already in memory. Caches the loading promise to prevent race
   * conditions from multiple concurrent messages.
   */
  private getOrLoadYdoc(projectId: string, fileName: string): Promise<Y.Doc> {
    const existingPromise = this.ydocPromises.get(fileName);
    if (existingPromise) {
      return existingPromise;
    }

    const newPromise = (async () => {
      const ydoc = new Y.Doc();
      const obj = await this.env.STORAGE.get(yjsSnapshotKey(projectId, fileName));
      if (obj) {
        Y.applyUpdate(ydoc, new Uint8Array(await obj.arrayBuffer()));
      }
      this.ydocs.set(fileName, ydoc);
      return ydoc;
    })();

    this.ydocPromises.set(fileName, newPromise);
    return newPromise;
  }

  private async saveSnapshot(projectId: string, fileName: string, ydoc: Y.Doc): Promise<void> {
    const state = Y.encodeStateAsUpdate(ydoc);
    await this.env.STORAGE.put(yjsSnapshotKey(projectId, fileName), state);
  }
}
