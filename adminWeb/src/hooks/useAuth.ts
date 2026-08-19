import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { changePassword, login, logout, me, switchCompany, updateMyProfileImage } from "@/services/auth";
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
    // Reported in the toaster like every other API failure — the credentials
    // form itself only shows Zod validation.
    meta: { errorTitle: "Couldn't sign in" },
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
 * The caller's identity + EFFECTIVE features for the active company. This is
 * what drives navigation and screen gating — the same set the server enforces,
 * so the rail can never offer a screen the API would refuse.
 *
 * Re-fetched after a company switch because `queryClient.clear()` drops it.
 */
export function useMe() {
  const signedIn = useSession((s) => s.signedIn);
  return useQuery({
    queryKey: ["me"],
    queryFn: me,
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
}

/**
 * Feature gating for the UI. Returns:
 *  - `loading` while the set is still arriving (callers must not redirect yet)
 *  - `has(key)` — true when the feature is granted, or when the key is absent
 *    (an ungated screen).
 *
 * Presentation only: hiding a link is not authorization. The server is the
 * authority and rejects a direct call regardless of what the rail shows.
 */
export function useFeatureAccess() {
  const { data, isPending } = useMe();
  const features = data?.features;
  return {
    loading: isPending,
    has: (key?: string) => !key || !!features?.includes(key),
  };
}

/**
 * Switch the active company. On success the re-scoped token replaces the old
 * one and every cached query is cleared — all list/detail data is per-company,
 * so it must refetch for the new scope.
 */
export function useSwitchCompany() {
  const setActiveCompany = useSession((s) => s.setActiveCompany);
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorTitle: "Couldn't switch company" },
    mutationFn: (companyId: string) => switchCompany(companyId),
    onSuccess: (payload) => {
      setActiveCompany(payload);
      queryClient.clear();
    },
  });
}

/**
 * Set or clear the caller's own profile photo.
 *
 * The photo is already in blob storage by the time this runs — `AvatarPicker`
 * uploads the crop and hands back a URL — so this only persists the reference
 * and refreshes the two places identity is read from: the `me` query and the
 * session's cached mirror the rail draws.
 */
export function useUpdateMyPhoto() {
  const setAvatar = useSession((s) => s.setAvatar);
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorTitle: "Couldn't update your photo" },
    mutationFn: (profileImageUrl: string | null) =>
      updateMyProfileImage(profileImageUrl),
    onSuccess: (next) => {
      setAvatar(next.user.profileImageUrl);
      queryClient.setQueryData(["me"], next);
    },
  });
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
      // This device's token only — the backend revokes every token the user
      // holds when it isn't given one, which would sign them out everywhere.
      await logout(useSession.getState().refreshToken);
    } catch {
      // Best-effort — clear locally regardless of the network result.
    }
    signOut();
    queryClient.clear();
  }, [signOut, queryClient]);
}

/**
 * Change your own password.
 *
 * Stores the returned pair: the backend revokes every other session, so the one
 * this browser held a moment ago is dead — without `setTokens` the next request
 * would 401 and sign the user out of the screen they just succeeded on.
 *
 * `gcTime: 0` so neither password lingers in the mutation cache, exactly as
 * `useLogin` does.
 */
export function useChangePassword() {
  const setTokens = useSession((s) => s.setTokens);
  return useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      changePassword(vars.currentPassword, vars.newPassword),
    onSuccess: (payload) =>
      setTokens({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      }),
    gcTime: 0,
    meta: { errorTitle: "Couldn't change your password" },
  });
}
