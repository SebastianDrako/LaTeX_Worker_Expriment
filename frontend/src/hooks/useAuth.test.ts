import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./useAuth";

vi.mock("../api/client");

import { getMe } from "../api/client";

const mockUser = {
  id: "user-1",
  sso_id: "google|123",
  provider: "google",
  name: "Alice",
  email: "alice@example.com",
  created_at: "2026-01-01T00:00:00Z",
};

describe("useAuth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("starts in loading state before getMe resolves", async () => {
    vi.mocked(getMe).mockResolvedValue(mockUser);
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe("loading");
    // Drain async so React can flush state updates cleanly
    await waitFor(() => expect(result.current.status).not.toBe("loading"));
  });

  it("transitions to authenticated when getMe resolves", async () => {
    vi.mocked(getMe).mockResolvedValue(mockUser);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect((result.current as Extract<ReturnType<typeof useAuth>, { status: "authenticated" }>).user).toEqual(mockUser);
  });

  it("transitions to error when getMe rejects", async () => {
    vi.mocked(getMe).mockRejectedValue(new Error("Unauthorized"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect((result.current as Extract<ReturnType<typeof useAuth>, { status: "error" }>).message).toBe("Unauthorized");
  });

  it("calls getMe exactly once on mount", async () => {
    vi.mocked(getMe).mockResolvedValue(mockUser);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(getMe).toHaveBeenCalledTimes(1);
  });
});
