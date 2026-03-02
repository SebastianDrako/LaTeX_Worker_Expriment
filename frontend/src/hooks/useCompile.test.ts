import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompile } from "./useCompile";

vi.mock("../api/client");

import {
  getFileBinary,
  getFileContent,
  listFiles,
  uploadOutputPdf,
} from "../api/client";
import type { ProjectFile } from "../types";

const file = (overrides: Partial<ProjectFile>): ProjectFile => ({
  id: "f1",
  project_id: "proj-1",
  name: "main.tex",
  r2_key: "projects/proj-1/tex/main.tex",
  type: "tex",
  size: 100,
  updated_at: "2026-01-01T00:00:00Z",
  updated_by: "user-1",
  ...overrides,
});

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // %PDF

describe("useCompile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("starts idle with no error log", () => {
    const { result } = renderHook(() => useCompile("proj-1"));
    expect(result.current.status).toBe("idle");
    expect(result.current.errorLog).toBeNull();
  });

  it("does nothing when projectId is null", async () => {
    const { result } = renderHook(() => useCompile(null));
    await act(async () => { await result.current.compile(); });
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("happy path: fetches files → posts to daemon → uploads PDF → success", async () => {
    vi.mocked(listFiles).mockResolvedValue([file({ name: "main.tex", type: "tex" })]);
    vi.mocked(getFileContent).mockResolvedValue("\\documentclass{article}\\begin{document}Hi\\end{document}");
    vi.mocked(uploadOutputPdf).mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(new Response(pdfBytes, { status: 200 }));

    const { result } = renderHook(() => useCompile("proj-1"));
    await act(async () => { await result.current.compile(); });

    expect(result.current.status).toBe("success");
    expect(result.current.errorLog).toBeNull();
    expect(uploadOutputPdf).toHaveBeenCalledWith("proj-1", pdfBytes);
  });

  it("sets status to error and stores log when daemon returns 422", async () => {
    vi.mocked(listFiles).mockResolvedValue([file({ name: "main.tex", type: "tex" })]);
    vi.mocked(getFileContent).mockResolvedValue("bad latex");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "compilation_failed", log: "! Undefined control sequence." }), { status: 422 }),
    );

    const { result } = renderHook(() => useCompile("proj-1"));
    await act(async () => { await result.current.compile(); });

    expect(result.current.status).toBe("error");
    expect(result.current.errorLog).toBe("! Undefined control sequence.");
    expect(uploadOutputPdf).not.toHaveBeenCalled();
  });

  it("shows helpful message when daemon is unreachable", async () => {
    vi.mocked(listFiles).mockResolvedValue([file({ name: "main.tex", type: "tex" })]);
    vi.mocked(getFileContent).mockResolvedValue("content");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useCompile("proj-1"));
    await act(async () => { await result.current.compile(); });

    expect(result.current.status).toBe("error");
    expect(result.current.errorLog).toContain("daemon");
    expect(result.current.errorLog).toContain("cargo run");
  });

  it("base64-encodes binary assets before sending to daemon", async () => {
    const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    vi.mocked(listFiles).mockResolvedValue([
      file({ name: "main.tex", type: "tex" }),
      file({ id: "f2", name: "fig.png", type: "image" }),
    ]);
    vi.mocked(getFileContent).mockResolvedValue("\\includegraphics{fig}");
    vi.mocked(getFileBinary).mockResolvedValue(imgBytes.buffer);
    vi.mocked(fetch).mockResolvedValue(new Response(pdfBytes, { status: 200 }));
    vi.mocked(uploadOutputPdf).mockResolvedValue(undefined);

    const { result } = renderHook(() => useCompile("proj-1"));
    await act(async () => { await result.current.compile(); });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init!.body as string) as { assets: Record<string, string> };
    // Verify the image was base64-encoded (not raw bytes)
    expect(typeof body.assets["fig.png"]).toBe("string");
    expect(body.assets["fig.png"]).toBe(btoa(String.fromCharCode(...imgBytes)));
  });

  it("falls back to first .tex when main.tex is absent", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      file({ name: "chapter.tex", type: "tex" }),
    ]);
    vi.mocked(getFileContent).mockResolvedValue("content");
    vi.mocked(fetch).mockResolvedValue(new Response(pdfBytes, { status: 200 }));
    vi.mocked(uploadOutputPdf).mockResolvedValue(undefined);

    const { result } = renderHook(() => useCompile("proj-1"));
    await act(async () => { await result.current.compile(); });

    expect(result.current.status).toBe("success");
    // getFileContent called twice: once in the parallel map (fails main.tex check),
    // once in the fallback block for chapter.tex
    expect(getFileContent).toHaveBeenCalledWith("proj-1", "chapter.tex");
  });

  it("transitions through compiling state", async () => {
    let resolveFetch!: (v: Response) => void;
    vi.mocked(listFiles).mockResolvedValue([file({ name: "main.tex", type: "tex" })]);
    vi.mocked(getFileContent).mockResolvedValue("content");
    vi.mocked(fetch).mockReturnValue(new Promise((r) => { resolveFetch = r; }));

    const { result } = renderHook(() => useCompile("proj-1"));

    act(() => { void result.current.compile(); });
    await waitFor(() => expect(result.current.status).toBe("compiling"));

    vi.mocked(uploadOutputPdf).mockResolvedValue(undefined);
    await act(async () => { resolveFetch(new Response(pdfBytes, { status: 200 })); });
    await waitFor(() => expect(result.current.status).toBe("success"));
  });
});
