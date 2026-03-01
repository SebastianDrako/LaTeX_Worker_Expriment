import { useCallback, useEffect, useState } from "react";
import {
  deleteFile as apiDeleteFile,
  getProject,
  listFiles,
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

  return { project, loading, error, reload, uploadFile, deleteFile };
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
