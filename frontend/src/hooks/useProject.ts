import { useCallback, useEffect, useState } from "react";
import {
  deleteFile as apiDeleteFile,
  getProject,
  listFiles,
  renameFile as apiRenameFile,
  renameProject as apiRenameProject,
  uploadFile as apiUploadFile,
} from "../api/client";
import type { ProjectDetail, ProjectFile } from "../types";

export function useProject(projectId: string | null) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await getProject(projectId);
      setProject(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!projectId) return;
      await apiUploadFile(projectId, file.name, file, file.type || "application/octet-stream");
      const files = await listFiles(projectId);
      setProject((p) => (p ? { ...p, files } : null));
    },
    [projectId],
  );

  const createFile = useCallback(
    async (name: string) => {
      if (!projectId) return;
      const ext = name.split(".").pop()?.toLowerCase();
      const initialContent =
        ext === "tex"
          ? "\\documentclass{article}\n\n\\begin{document}\n\n\\end{document}\n"
          : "";
      await apiUploadFile(projectId, name, initialContent, "text/plain");
      const files = await listFiles(projectId);
      setProject((p) => (p ? { ...p, files } : null));
    },
    [projectId],
  );

  const deleteFile = useCallback(
    async (fileName: string) => {
      if (!projectId) return;
      await apiDeleteFile(projectId, fileName);
      setProject((p) =>
        p ? { ...p, files: p.files.filter((f) => f.name !== fileName) } : null,
      );
    },
    [projectId],
  );

  const renameFile = useCallback(
    async (oldName: string, newName: string) => {
      if (!projectId) return;
      await apiRenameFile(projectId, oldName, newName);
      const files = await listFiles(projectId);
      setProject((p) => (p ? { ...p, files } : null));
    },
    [projectId],
  );

  const renameProjectName = useCallback(
    async (newName: string) => {
      if (!projectId) return;
      await apiRenameProject(projectId, newName);
      setProject((p) => (p ? { ...p, name: newName } : null));
    },
    [projectId],
  );

  return { project, loading, error, reload, uploadFile, createFile, deleteFile, renameFile, renameProjectName };
}

export function useSelectedFile(files: ProjectFile[]) {
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);

  // Auto-select main.tex or first .tex file on load
  useEffect(() => {
    if (files.length === 0) return;
    const main =
      files.find((f) => f.name === "main.tex") ??
      files.find((f) => f.type === "tex") ??
      files[0];
    setSelectedFile(main ?? null);
  }, [files]);

  return { selectedFile, setSelectedFile };
}
