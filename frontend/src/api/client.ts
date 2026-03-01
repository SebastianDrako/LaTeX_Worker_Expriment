import type { Project, ProjectDetail, ProjectFile, User } from "../types";

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

// ── WebSocket URL helper ───────────────────────────────────────────────────────

export function wsUrl(projectId: string): string {
  const workerUrl = import.meta.env.VITE_WORKER_URL ?? "";
  const base = workerUrl.replace(/^http/, "ws") || `ws://${location.host}`;
  return `${base}/api/projects/${projectId}/ws`;
}
