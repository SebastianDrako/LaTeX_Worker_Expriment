import { useEffect, useState } from "react";
import { getMe } from "../api/client";
import type { User } from "../types";

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "error"; message: string };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    getMe()
      .then((user) => setState({ status: "authenticated", user }))
      .catch((err: Error) =>
        setState({ status: "error", message: err.message }),
      );
  }, []);

  return state;
}
