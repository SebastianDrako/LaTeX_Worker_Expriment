import type { AccessClaims } from "./auth";

export interface User {
  id: string;
  sso_id: string;
  provider: string;
  name: string;
  email: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: string;
  project_id: string;
  name: string;
  r2_key: string;
  type: "tex" | "bib" | "image" | "pdf";
  size: number | null;
  updated_at: string;
  updated_by: string;
}

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * Upserts a user from SSO claims. Creates the user on first login.
 * Uses a SELECT-then-INSERT pattern compatible with D1 (no ON CONFLICT yet).
 */
export async function upsertUser(db: D1Database, claims: AccessClaims): Promise<User> {
  const existing = await db
    .prepare("SELECT * FROM users WHERE sso_id = ?")
    .bind(claims.sub)
    .first<User>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Derive provider from the Access issuer hostname (e.g. "myteam.cloudflareaccess.com" → "cloudflare")
  const provider = "cloudflare";

  await db
    .prepare("INSERT INTO users (id, sso_id, provider, name, email, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, claims.sub, provider, claims.name, claims.email, now)
    .run();

  return { id, sso_id: claims.sub, provider, name: claims.name, email: claims.email, created_at: now };
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function getUserProjects(db: D1Database, userId: string): Promise<Project[]> {
  const result = await db
    .prepare(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ?
       ORDER BY p.updated_at DESC`,
    )
    .bind(userId)
    .all<Project>();
  return result.results;
}

export async function createProject(
  db: D1Database,
  name: string,
  ownerId: string,
): Promise<Project> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, name, ownerId, now, now),
    db
      .prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)")
      .bind(id, ownerId, "owner"),
  ]);
  return { id, name, owner_id: ownerId, created_at: now, updated_at: now };
}

export async function getProject(db: D1Database, projectId: string): Promise<Project | null> {
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<Project>();
}

export async function deleteProject(db: D1Database, projectId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM files WHERE project_id = ?").bind(projectId),
    db.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projectId),
    db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId),
  ]);
}

export async function getMemberRole(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<{ role: string }>();
  return row?.role ?? null;
}

export async function updateProjectTimestamp(db: D1Database, projectId: string): Promise<void> {
  await db
    .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), projectId)
    .run();
}

// ── Files ─────────────────────────────────────────────────────────────────────

export async function getProjectFiles(db: D1Database, projectId: string): Promise<FileRecord[]> {
  const result = await db
    .prepare("SELECT * FROM files WHERE project_id = ? ORDER BY name")
    .bind(projectId)
    .all<FileRecord>();
  return result.results;
}

export async function upsertFile(db: D1Database, file: Omit<FileRecord, "id">): Promise<FileRecord> {
  const existing = await db
    .prepare("SELECT id FROM files WHERE project_id = ? AND name = ?")
    .bind(file.project_id, file.name)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        "UPDATE files SET r2_key = ?, type = ?, size = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      )
      .bind(file.r2_key, file.type, file.size, file.updated_at, file.updated_by, existing.id)
      .run();
    return { id: existing.id, ...file };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO files (id, project_id, name, r2_key, type, size, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, file.project_id, file.name, file.r2_key, file.type, file.size, file.updated_at, file.updated_by)
    .run();
  return { id, ...file };
}

export async function deleteFile(
  db: D1Database,
  projectId: string,
  name: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT r2_key FROM files WHERE project_id = ? AND name = ?")
    .bind(projectId, name)
    .first<{ r2_key: string }>();
  if (!row) return null;
  await db.prepare("DELETE FROM files WHERE project_id = ? AND name = ?").bind(projectId, name).run();
  return row.r2_key;
}
