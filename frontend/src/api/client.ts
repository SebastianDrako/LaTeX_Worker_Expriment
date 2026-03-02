import type { Member, Project, ProjectDetail, ProjectFile, User } from "../types";

const BASE = import.meta.env.VITE_WORKER_URL ?? "";

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, init);
  return res;
}

async function apiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function getMe(): Promise<User> {
  return apiJSON<User>("/api/me");
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  return apiJSON<Project[]>("/api/projects");
}

export async function createProject(name: string): Promise<Project> {
  return apiJSON<Project>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  return apiJSON<ProjectDetail>(`/api/projects/${projectId}`);
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function renameProject(projectId: string, newName: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Files ─────────────────────────────────────────────────────────────────────

export async function listFiles(projectId: string): Promise<ProjectFile[]> {
  return apiJSON<ProjectFile[]>(`/api/projects/${projectId}/files`);
}

export async function getFileContent(
  projectId: string,
  fileName: string,
): Promise<string> {
  const res = await apiFetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(fileName)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function getFileBinary(
  projectId: string,
  fileName: string,
): Promise<ArrayBuffer> {
  const res = await apiFetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(fileName)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function uploadFile(
  projectId: string,
  fileName: string,
  body: BodyInit,
  contentType: string,
): Promise<ProjectFile> {
  return apiJSON<ProjectFile>(
    `/api/projects/${projectId}/files/${encodeURIComponent(fileName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    },
  );
}

export async function deleteFile(
  projectId: string,
  fileName: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(fileName)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function renameFile(
  projectId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(oldName)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function getOutputPdf(projectId: string): Promise<ArrayBuffer> {
  const res = await apiFetch(`/api/projects/${projectId}/output.pdf`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function uploadOutputPdf(
  projectId: string,
  pdfBytes: ArrayBuffer,
): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}/output.pdf`, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: pdfBytes,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function getMembers(projectId: string): Promise<Member[]> {
  return apiJSON<Member[]>(`/api/projects/${projectId}/members`);
}

export async function addMember(
  projectId: string,
  email: string,
  role: "editor" | "viewer",
): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
}

export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: "editor" | "viewer",
): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Yjs snapshot ──────────────────────────────────────────────────────────────

/**
 * Fetches the persisted Yjs CRDT snapshot for a file.
 * Returns null if no snapshot exists yet (first session or file never edited
 * collaboratively). Errors from the network are propagated as exceptions.
 */
export async function fetchYjsSnapshot(
  projectId: string,
  fileName: string,
): Promise<Uint8Array | null> {
  const res = await apiFetch(
    `/api/projects/${projectId}/yjs/${encodeURIComponent(fileName)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── WebSocket URL helper ───────────────────────────────────────────────────────

/**
 * Builds the WebSocket URL for the project room.
 * Pass `fileName` when the connection is used for Yjs collaboration so the
 * Durable Object can track the Y.Doc per file. Omit it for notification-only
 * connections (e.g. usePdfReload).
 */
export function wsUrl(projectId: string, fileName?: string): string {
  const workerUrl = import.meta.env.VITE_WORKER_URL ?? "";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const base = workerUrl.replace(/^http/, "ws") || `${proto}//${location.host}`;
  const url = `${base}/api/projects/${projectId}/ws`;
  return fileName ? `${url}?file=${encodeURIComponent(fileName)}` : url;
}
