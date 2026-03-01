import { validateJwt } from "./auth";
import {
  createProject,
  deleteFile,
  deleteProject,
  getMemberRole,
  getProject,
  getProjectFiles,
  getUserProjects,
  updateProjectTimestamp,
  upsertFile,
  upsertUser,
  type User,
} from "./db";
import {
  contentTypeFor,
  fileTypeFromName,
  outputPdfKey,
  r2KeyForSourceFile,
} from "./storage";

export { ProjectRoom } from "./do/ProjectRoom";

// ── Env ───────────────────────────────────────────────────────────────────────

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  PROJECT_ROOM: DurableObjectNamespace;
  /** e.g. "myteam.cloudflareaccess.com"  — set via `wrangler secret put` */
  CF_ACCESS_TEAM_DOMAIN: string;
  /** Application Audience Tag from the Access dashboard — set via `wrangler secret put` */
  CF_ACCESS_AUD: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status: number): Response {
  return json({ error: message }, status);
}

/** Returns the ProjectRoom DO stub for a given project. */
function roomFor(env: Env, projectId: string): DurableObjectStub {
  return env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(projectId));
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // ── Auth ────────────────────────────────────────────────────────────────
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return err("Unauthorized", 401);

    const claims = await validateJwt(token, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
    if (!claims) return err("Unauthorized", 401);

    const user: User = await upsertUser(env.DB, claims);

    // ── GET /api/me ─────────────────────────────────────────────────────────
    if (pathname === "/api/me" && method === "GET") {
      return json(user);
    }

    // ── GET /api/projects ───────────────────────────────────────────────────
    if (pathname === "/api/projects" && method === "GET") {
      return json(await getUserProjects(env.DB, user.id));
    }

    // ── POST /api/projects ──────────────────────────────────────────────────
    if (pathname === "/api/projects" && method === "POST") {
      const body = (await request.json()) as { name?: string };
      if (!body.name?.trim()) return err("name is required", 400);
      return json(await createProject(env.DB, body.name.trim(), user.id), 201);
    }

    // ── /api/projects/:id[/...] ─────────────────────────────────────────────
    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
    if (!projectMatch) return err("Not found", 404);

    const projectId = projectMatch[1];
    const rest = projectMatch[2] ?? "";

    const project = await getProject(env.DB, projectId);
    if (!project) return err("Project not found", 404);

    const role = await getMemberRole(env.DB, projectId, user.id);
    if (!role) return err("Forbidden", 403);

    const canWrite = role === "owner" || role === "editor";

    // ── GET /api/projects/:id ───────────────────────────────────────────────
    if (rest === "" && method === "GET") {
      const files = await getProjectFiles(env.DB, projectId);
      return json({ ...project, role, files });
    }

    // ── DELETE /api/projects/:id ────────────────────────────────────────────
    if (rest === "" && method === "DELETE") {
      if (role !== "owner") return err("Forbidden", 403);
      const files = await getProjectFiles(env.DB, projectId);
      await Promise.all([
        ...files.map((f) => env.STORAGE.delete(f.r2_key)),
        env.STORAGE.delete(outputPdfKey(projectId)),
        deleteProject(env.DB, projectId),
      ]);
      return new Response(null, { status: 204 });
    }

    // ── GET /api/projects/:id/files ─────────────────────────────────────────
    if (rest === "/files" && method === "GET") {
      return json(await getProjectFiles(env.DB, projectId));
    }

    // ── /api/projects/:id/files/:name ───────────────────────────────────────
    const fileMatch = rest.match(/^\/files\/(.+)$/);
    if (fileMatch) {
      const fileName = decodeURIComponent(fileMatch[1]);
      const fileType = fileTypeFromName(fileName);
      const r2Key = r2KeyForSourceFile(projectId, fileName, fileType);

      if (method === "GET") {
        const obj = await env.STORAGE.get(r2Key);
        if (!obj) return err("File not found", 404);
        return new Response(obj.body, {
          headers: { "Content-Type": contentTypeFor(fileType) },
        });
      }

      if (method === "PUT") {
        if (!canWrite) return err("Forbidden", 403);
        if (!request.body) return err("Body required", 400);
        const size = parseInt(request.headers.get("content-length") ?? "0", 10) || null;
        await env.STORAGE.put(r2Key, request.body);
        const now = new Date().toISOString();
        const file = await upsertFile(env.DB, {
          project_id: projectId,
          name: fileName,
          r2_key: r2Key,
          type: fileType,
          size,
          updated_at: now,
          updated_by: user.id,
        });
        await updateProjectTimestamp(env.DB, projectId);
        return json(file);
      }

      if (method === "DELETE") {
        if (!canWrite) return err("Forbidden", 403);
        const deletedKey = await deleteFile(env.DB, projectId, fileName);
        if (!deletedKey) return err("File not found", 404);
        await env.STORAGE.delete(deletedKey);
        await updateProjectTimestamp(env.DB, projectId);
        return new Response(null, { status: 204 });
      }
    }

    // ── GET /api/projects/:id/output.pdf ────────────────────────────────────
    if (rest === "/output.pdf" && method === "GET") {
      const obj = await env.STORAGE.get(outputPdfKey(projectId));
      if (!obj) return err("No compiled PDF yet", 404);
      return new Response(obj.body, { headers: { "Content-Type": "application/pdf" } });
    }

    // ── PUT /api/projects/:id/output.pdf ────────────────────────────────────
    // Called by the frontend after the local daemon compiles a PDF successfully.
    if (rest === "/output.pdf" && method === "PUT") {
      if (!canWrite) return err("Forbidden", 403);
      if (!request.body) return err("Body required", 400);
      await env.STORAGE.put(outputPdfKey(projectId), request.body, {
        httpMetadata: { contentType: "application/pdf" },
      });
      // Notify all WebSocket clients for this project
      ctx.waitUntil(
        roomFor(env, projectId).fetch(
          new Request("https://do/broadcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "pdf_updated" }),
          }),
        ),
      );
      return new Response(null, { status: 204 });
    }

    // ── GET /api/projects/:id/ws ────────────────────────────────────────────
    // Upgrade to WebSocket; the Durable Object manages the connection.
    if (rest === "/ws" && method === "GET") {
      return roomFor(env, projectId).fetch(
        new Request("https://do/ws", request),
      );
    }

    return err("Not found", 404);
  },
};
