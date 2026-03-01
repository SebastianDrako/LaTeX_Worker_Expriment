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

export interface ProjectDetail extends Project {
  role: "owner" | "editor" | "viewer";
  files: ProjectFile[];
}

export interface ProjectFile {
  id: string;
  project_id: string;
  name: string;
  r2_key: string;
  type: "tex" | "bib" | "image" | "pdf";
  size: number | null;
  updated_at: string;
  updated_by: string;
}

export type CompileStatus = "idle" | "compiling" | "success" | "error";

export interface CompileError {
  error: "compilation_failed";
  log: string;
}
