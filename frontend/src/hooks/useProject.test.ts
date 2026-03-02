import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProject, useSelectedFile } from "./useProject";

vi.mock("../api/client");

import {
  deleteFile as apiDeleteFile,
  getProject,
  listFiles,
  uploadFile as apiUploadFile,
} from "../api/client";
import type { ProjectDetail, ProjectFile } from "../types";

const mockFile = (overrides?: Partial<ProjectFile>): ProjectFile => ({
  id: "file-1",
  project_id: "proj-1",
  name: "main.tex",
  r2_key: "projects/proj-1/tex/main.tex",
  type: "tex",
  size: 100,
  updated_at: "2026-01-01T00:00:00Z",
  updated_by: "user-1",
  ...overrides,
});

const mockProject = (files: ProjectFile[] = []): ProjectDetail => ({
  id: "proj-1",
  name: "My Project",
  owner_id: "user-1",
  role: "owner",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  files,
});

describe("useProject", () => {
  beforeEach(() => vi.resetAllMocks());

  it("starts in loading state before getProject resolves", async () => {
    vi.mocked(getProject).mockResolvedValue(mockProject());
    const { result } = renderHook(() => useProject("proj-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.project).toBeNull();
    // Drain async so React can flush state updates cleanly
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("loads project on mount", async () => {
    const project = mockProject([mockFile()]);
    vi.mocked(getProject).mockResolvedValue(project);
    const { result } = renderHook(() => useProject("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.project).toEqual(project);
    expect(result.current.error).toBeNull();
  });

  it("sets error when getProject rejects", async () => {
    vi.mocked(getProject).mockRejectedValue(new Error("Not found"));
    const { result } = renderHook(() => useProject("proj-1"));
    await waitFor(() => expect(result.current.error).toBe("Not found"));
    expect(result.current.project).toBeNull();
  });

  it("does nothing when projectId is null", () => {
    const { result } = renderHook(() => useProject(null));
    expect(result.current.loading).toBe(false);
    expect(getProject).not.toHaveBeenCalled();
  });

  it("uploadFile adds file to state and refreshes list", async () => {
    const initial = mockProject([mockFile()]);
    const newFile = mockFile({ id: "file-2", name: "chapter.tex" });
    vi.mocked(getProject).mockResolvedValue(initial);
    vi.mocked(apiUploadFile).mockResolvedValue(newFile);
    vi.mocked(listFiles).mockResolvedValue([mockFile(), newFile]);

    const { result } = renderHook(() => useProject("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const file = new File(["content"], "chapter.tex", { type: "text/plain" });
    await act(async () => { await result.current.uploadFile(file); });

    expect(apiUploadFile).toHaveBeenCalledWith("proj-1", "chapter.tex", file, "text/plain");
    expect(result.current.project?.files).toHaveLength(2);
  });

  it("deleteFile removes file from state", async () => {
    const f1 = mockFile();
    const f2 = mockFile({ id: "file-2", name: "refs.bib", type: "bib" });
    vi.mocked(getProject).mockResolvedValue(mockProject([f1, f2]));
    vi.mocked(apiDeleteFile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProject("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.deleteFile("main.tex"); });

    expect(result.current.project?.files).toHaveLength(1);
    expect(result.current.project?.files[0].name).toBe("refs.bib");
  });
});

describe("useSelectedFile", () => {
  it("auto-selects main.tex if present", async () => {
    const files = [
      mockFile({ name: "chapter.tex" }),
      mockFile({ id: "f2", name: "main.tex" }),
    ];
    const { result } = renderHook(() => useSelectedFile(files));
    await waitFor(() => expect(result.current.selectedFile?.name).toBe("main.tex"));
  });

  it("auto-selects first .tex if no main.tex", async () => {
    const files = [mockFile({ name: "chapter.tex" })];
    const { result } = renderHook(() => useSelectedFile(files));
    await waitFor(() => expect(result.current.selectedFile?.name).toBe("chapter.tex"));
  });

  it("returns null when file list is empty", () => {
    const { result } = renderHook(() => useSelectedFile([]));
    expect(result.current.selectedFile).toBeNull();
  });
});
