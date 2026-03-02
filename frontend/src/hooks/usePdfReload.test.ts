import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest"; // Removed afterEach
import { usePdfReload } from "./usePdfReload";
import { RobustWebSocket } from "../api/websocket"; // Import the actual RobustWebSocket

// ── RobustWebSocket mock ──────────────────────────────────────────────────────

// Mock the RobustWebSocket module
vi.mock("../api/websocket", () => {
  const mockRobustWebSocket = vi.fn(function (this: any, url: string) {
    this.url = url;
    this.onopen = vi.fn();
    this.onmessage = vi.fn();
    this.onclose = vi.fn();
    this.send = vi.fn();
    this.close = vi.fn();
    // Helper to simulate server sending a message
    this.receive = (data: string | ArrayBuffer) => {
      this.onmessage({ data } as MessageEvent);
    };
    (mockRobustWebSocket as any).instances.push(this); // Cast to any
  }) as unknown as { new(url: string): RobustWebSocket & { receive: (data: string | ArrayBuffer) => void } };

  (mockRobustWebSocket as any).instances = []; // Store all created instances, cast to any
  return { RobustWebSocket: mockRobustWebSocket };
});

describe("usePdfReload", () => {
  beforeEach(() => {
    // Clear instances before each test
    (RobustWebSocket as any).instances = []; // Cast to any
  });

  it("opens a RobustWebSocket for the project on mount", () => {
    renderHook(() => usePdfReload("proj-1", vi.fn()));
    const instances = (RobustWebSocket as any).instances; // Cast to any
    expect(instances).toHaveLength(1);
    expect((instances[0] as { url: string }).url).toContain("proj-1");
  });

  it("does not open a RobustWebSocket when projectId is null", () => {
    renderHook(() => usePdfReload(null, vi.fn()));
    const instances = (RobustWebSocket as any).instances; // Cast to any
    expect(instances).toHaveLength(0);
  });

  it("calls onPdfUpdated when pdf_updated event is received", () => {
    const onPdfUpdated = vi.fn();
    renderHook(() => usePdfReload("proj-1", onPdfUpdated));
    const instances = (RobustWebSocket as any).instances; // Cast to any

    act(() => {
      (instances[0] as { receive: (data: string) => void }).receive(JSON.stringify({ event: "pdf_updated" }));
    });

    expect(onPdfUpdated).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown JSON events", () => {
    const onPdfUpdated = vi.fn();
    renderHook(() => usePdfReload("proj-1", onPdfUpdated));
    const instances = (RobustWebSocket as any).instances; // Cast to any

    act(() => {
      (instances[0] as { receive: (data: string) => void }).receive(JSON.stringify({ event: "some_other_event" }));
    });

    expect(onPdfUpdated).not.toHaveBeenCalled();
  });

  it("ignores binary (Yjs) messages", () => {
    const onPdfUpdated = vi.fn();
    renderHook(() => usePdfReload("proj-1", onPdfUpdated));
    const instances = (RobustWebSocket as any).instances; // Cast to any

    act(() => {
      (instances[0] as { receive: (data: ArrayBuffer) => void }).receive(new ArrayBuffer(8));
    });

    expect(onPdfUpdated).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON without throwing", () => {
    const onPdfUpdated = vi.fn();
    renderHook(() => usePdfReload("proj-1", onPdfUpdated));
    const instances = (RobustWebSocket as any).instances; // Cast to any

    expect(() =>
      act(() => { (instances[0] as { receive: (data: string) => void }).receive("not-json{{{"); }),
    ).not.toThrow();
    expect(onPdfUpdated).not.toHaveBeenCalled();
  });

  it("closes the RobustWebSocket on unmount", () => {
    const { unmount } = renderHook(() => usePdfReload("proj-1", vi.fn()));
    const instances = (RobustWebSocket as any).instances; // Cast to any
    const wsInstance = instances[0] as { close: () => void };

    expect(wsInstance.close).not.toHaveBeenCalled();
    unmount();
    expect(wsInstance.close).toHaveBeenCalledTimes(1);
  });

  it("always calls the latest version of the callback", () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(({ cb }) => usePdfReload("proj-1", cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    const instances = (RobustWebSocket as any).instances; // Cast to any

    act(() => {
      (instances[0] as { receive: (data: string) => void }).receive(JSON.stringify({ event: "pdf_updated" }));
    });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
