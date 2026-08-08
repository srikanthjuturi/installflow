import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login, logout } from "@/services/auth";
import { useSession } from "@/store/session";

/**
 * Sign-in and sign-out against the live backend.
 *
 * The session itself is client state (Zustand); these hooks are the seam that
 * fills it from the API. Components import from here — never from
 * `services/auth`.
 */

export interface LoginVariables {
  email: string;
  password: string;
}

/**
 * Single-step sign-in. The backend is password-only (no OTP), so a successful
 * call is the session: on success the payload is written to the store and every
 * cached query is cleared, because a new identity must not inherit the previous
 * one's server-scoped lists.
 */
export function useLogin() {
  const signInBackend = useSession((s) => s.signInBackend);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, password }: LoginVariables) => login(email, password),
    onSuccess: (payload) => {
      queryClient.clear();
      signInBackend(payload);
    },
    // The password is a mutation variable; drop the cache entry as soon as the
    // call settles so it is not retained in memory (or devtools).
    gcTime: 0,
  });
}

/** The signed-in backend account, or `null` when signed out. */
export function useCurrentUser() {
  return useSession((s) => s.backendUser);
}

/**
 * The mock ops-console account (numeric-role `AuthUser`). Retained for the
 * still-mocked account/ops screens; the superadmin module uses `useCurrentUser`.
 */
export function useAuthUser() {
  return useSession((s) => s.user);
}

/**
 * Sign out: revoke server-side (best-effort, while the token is still present),
 * then clear the token, the user and every cached query. The caller should do a
 * hard redirect afterwards so no in-memory state or bfcache snapshot survives.
 */
export function useSignOut() {
  const signOut = useSession((s) => s.signOut);
  const queryClient = useQueryClient();

  return useCallback(async () => {
    try {
      await logout();
    } catch {
      // Best-effort — clear locally regardless of the network result.
    }
    signOut();
    queryClient.clear();
  }, [signOut, queryClient]);
}
