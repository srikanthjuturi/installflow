import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login, verifyOtp } from "@/services/auth";
import { useSession } from "@/store/session";

/**
 * Sign-in and sign-out.
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
 * Step 1 — credentials. Succeeding here does **not** sign anyone in: the
 * payload stays in the mutation's result and never reaches the store.
 */
export function useLogin() {
  return useMutation({
    mutationFn: ({ email, password }: LoginVariables) => login(email, password),
    // A mutation's `variables` are retained after it settles, and the password
    // is one of them. Dropping the cache entry immediately keeps the submitted
    // password out of memory (and out of devtools) once the call is done.
    gcTime: 0,
  });
}

/** Step 2 — the one-time code. Its payload is what becomes the session. */
export function useVerifyOtp() {
  const signIn = useSession((s) => s.signIn);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => verifyOtp(code),
    onSuccess: (payload) => {
      // A new identity must not inherit the previous one's cached lists — the
      // server scopes what each user may read.
      queryClient.clear();
      signIn(payload);
    },
    gcTime: 0,
  });
}

/** The signed-in account as the API returned it, or `null` when signed out. */
export function useAuthUser() {
  return useSession((s) => s.user);
}

/** Clears the token, the user and every cached query in one action. */
export function useSignOut() {
  const signOut = useSession((s) => s.signOut);
  const queryClient = useQueryClient();

  return useCallback(() => {
    signOut();
    queryClient.clear();
  }, [signOut, queryClient]);
}
