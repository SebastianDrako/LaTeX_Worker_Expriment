import { validateJwt } from "./auth";
import {
  addProjectMember,
  createProject,
  deleteFile,
  deleteProject,
  findUserByEmail,
  getMemberRole,
  getProject,
  getProjectFiles,
  getProjectMembers,
  getUserProjects,
  removeProjectMember,
  renameFile,
  renameProject,
  updateMemberRole,
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
  yjsSnapshotKey,
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

    // ── PATCH /api/projects/:id — { name } ─────────────────────────────────
    if (rest === "" && method === "PATCH") {
      if (role !== "owner") return err("Forbidden", 403);
      const body = (await request.json()) as { name?: string };
      if (!body.name?.trim()) return err("name is required", 400);
      await renameProject(env.DB, projectId, body.name.trim());
      return new Response(null, { status: 204 });
    }

    // ── DELETE /api/projects/:id ────────────────────────────────────────────
    if (rest === "" && method === "DELETE") {
      if (role !== "owner") return err("Forbidden", 403);
      const files = await getProjectFiles(env.DB, projectId);

      const r2KeysToDelete = [
        ...files.map((f) => f.r2_key),
        ...files.map((f) => yjsSnapshotKey(projectId, f.name)),
        outputPdfKey(projectId),
      ];

      const results = await Promise.allSettled(
        r2KeysToDelete.map((key) => env.STORAGE.delete(key)),
      );

      for (const result of results) {
        if (result.status === "rejected") {
          // In a real app, this would go to a proper logging service.
          console.error(`Failed to delete R2 object: ${result.reason}`);
        }
      }

      // Always attempt to delete the database records, even if R2 cleanup fails.
      await deleteProject(env.DB, projectId);

      return new Response(null, { status: 204 });
    }

    // ── GET /api/projects/:id/members ───────────────────────────────────────
    if (rest === "/members" && method === "GET") {
      return json(await getProjectMembers(env.DB, projectId));
    }

    // ── POST /api/projects/:id/members — { email, role } ────────────────────
    if (rest === "/members" && method === "POST") {
      if (role !== "owner") return err("Forbidden", 403);
      const body = (await request.json()) as { email?: string; role?: string };
      if (!body.email?.trim()) return err("email is required", 400);
      if (body.role !== "editor" && body.role !== "viewer")
        return err("role must be 'editor' or 'viewer'", 400);

      const target = await findUserByEmail(env.DB, body.email.trim());
      if (!target) return err("User not found. Ask them to log in first.", 404);

      const existing = await getMemberRole(env.DB, projectId, target.id);
      if (existing) return err("User is already a member", 409);

      await addProjectMember(env.DB, projectId, target.id, body.role);
      return new Response(null, { status: 204 });
    }

    // ── /api/projects/:id/members/:userId ───────────────────────────────────
    const memberMatch = rest.match(/^\/members\/([^/]+)$/);
    if (memberMatch) {
      if (role !== "owner") return err("Forbidden", 403);
      const targetId = memberMatch[1];

      const targetRole = await getMemberRole(env.DB, projectId, targetId);
      if (!targetRole) return err("Member not found", 404);
      if (targetRole === "owner") return err("Cannot modify the project owner", 400);

      if (method === "PATCH") {
        const body = (await request.json()) as { role?: string };
        if (body.role !== "editor" && body.role !== "viewer")
          return err("role must be 'editor' or 'viewer'", 400);
        await updateMemberRole(env.DB, projectId, targetId, body.role);
        return new Response(null, { status: 204 });
      }

      if (method === "DELETE") {
        await removeProjectMember(env.DB, projectId, targetId);
        return new Response(null, { status: 204 });
      }
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
          headers: { "Content-Type": contentTypeFor(fileName, fileType) },
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
        ctx.waitUntil(
          roomFor(env, projectId).fetch(
            new Request("https://do/broadcast", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "files_updated" }),
            }),
          ),
        );
        return json(file);
      }

      if (method === "PATCH") {
        if (!canWrite) return err("Forbidden", 403);
        const body = (await request.json()) as { newName?: string };
        if (!body.newName?.trim()) return err("newName is required", 400);
        const newName = body.newName.trim();
        if (newName === fileName) return new Response(null, { status: 204 });

        // Check the target name is not already taken
        const existingFiles = await getProjectFiles(env.DB, projectId);
        if (existingFiles.some((f) => f.name === newName)) {
          return err("A file with that name already exists", 409);
        }

        const fileType = fileTypeFromName(newName);
        const newR2Key = r2KeyForSourceFile(projectId, newName, fileType);

        // R2 has no native rename — copy then delete.
        const obj = await env.STORAGE.get(r2KeyForSourceFile(projectId, fileName, fileTypeFromName(fileName)));
        if (!obj) return err("File not found", 404);
        await env.STORAGE.put(newR2Key, obj.body);

        // Also copy the Yjs snapshot if one exists for the old name.
        const oldYjsKey = yjsSnapshotKey(projectId, fileName);
        const newYjsKey = yjsSnapshotKey(projectId, newName);
        const yjsObj = await env.STORAGE.get(oldYjsKey);
        if (yjsObj) {
          await env.STORAGE.put(newYjsKey, yjsObj.body);
          await env.STORAGE.delete(oldYjsKey);
        }

        const oldR2Key = await renameFile(env.DB, projectId, fileName, newName, newR2Key);
        if (oldR2Key) await env.STORAGE.delete(oldR2Key);

        await updateProjectTimestamp(env.DB, projectId);
        ctx.waitUntil(
          roomFor(env, projectId).fetch(
            new Request("https://do/broadcast", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "files_updated" }),
            }),
          ),
        );
        return new Response(null, { status: 204 });
      }

      if (method === "DELETE") {
        if (!canWrite) return err("Forbidden", 403);
        const deletedKey = await deleteFile(env.DB, projectId, fileName);
        if (!deletedKey) return err("File not found", 404);
        await env.STORAGE.delete(deletedKey);
        await updateProjectTimestamp(env.DB, projectId);
        ctx.waitUntil(
          roomFor(env, projectId).fetch(
            new Request("https://do/broadcast", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "files_updated" }),
            }),
          ),
        );
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

    // ── GET /api/projects/:id/yjs/:name ────────────────────────────────────
    // Serve the Yjs CRDT snapshot for a file so new clients can bootstrap
    // from the full collaborative state instead of plain text.
    const yjsMatch = rest.match(/^\/yjs\/(.+)$/);
    if (yjsMatch && method === "GET") {
      const fileName = decodeURIComponent(yjsMatch[1]);
      const obj = await env.STORAGE.get(yjsSnapshotKey(projectId, fileName));
      if (!obj) return err("No snapshot yet", 404);
      return new Response(obj.body, {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }

    // ── GET /api/projects/:id/ws ────────────────────────────────────────────
    // Upgrade to WebSocket; the Durable Object manages the connection.
    // Pass project and file as query params so the DO can track per-file Y.Docs.
    if (rest === "/ws" && method === "GET") {
      const fileName = url.searchParams.get("file") ?? "main.tex";
      const doUrl = new URL("https://do/ws");
      doUrl.searchParams.set("project", projectId);
      doUrl.searchParams.set("file", fileName);
      return roomFor(env, projectId).fetch(new Request(doUrl.toString(), request));
    }

    return err("Not found", 404);
  },
};
