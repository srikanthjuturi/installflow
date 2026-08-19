import { apiGet, apiPatch, apiPost } from "./http";
import type {
  LoginResponse,
  MeResponse,
  SwitchCompanyResponse,
} from "@/types/api";

/**
 * Sign in against the live backend (`POST /auth/login`).
 *
 * Password-only — the backend has no OTP second factor (that belongs to the
 * technician mobile app). The password is an argument only: nothing here
 * stores, logs, echoes or returns it. On success the backend answers with the
 * user, their company memberships and a bearer token, wrapped in the standard
 * envelope that `apiPost` unwraps.
 */
export function login(email: string, password: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/login", {
    email: email.trim(),
    password,
  });
}

/**
 * Revoke the session server-side. Uses the current bearer token (added by the
 * transport), so call it BEFORE clearing the session locally.
 *
 * The refresh token is **required** for a single-device sign-out: omit it and
 * the backend revokes every unrevoked token this user holds, signing them out
 * of every other browser too. Pass `null` only to mean exactly that.
 *
 * Renewal itself is not here — it lives in `services/http.ts`, because it is
 * transport plumbing that fires on a 401, not something a screen ever calls.
 */
export function logout(refreshToken: string | null): Promise<null> {
  return apiPost<null>("/auth/logout", { refreshToken });
}

/** The caller's identity plus their effective features for the active company. */
export function me(): Promise<MeResponse> {
  return apiGet<MeResponse>("/auth/me");
}

/**
 * Set or clear the caller's OWN profile photo — `null` removes it.
 *
 * Self-service, and deliberately not `PUT /users/{membership}`: that endpoint
 * is a manager editing somebody else and is feature-guarded accordingly. The
 * photo must be uploaded first (`services/uploads.ts`); what is stored is its
 * URL.
 */
export function updateMyProfileImage(
  profileImageUrl: string | null
): Promise<MeResponse> {
  return apiPatch<MeResponse>("/auth/me", { profileImageUrl });
}

/** Re-scope the session to another company the caller belongs to. */
export function switchCompany(
  companyId: string
): Promise<SwitchCompanyResponse> {
  return apiPost<SwitchCompanyResponse>("/auth/switch-company", { companyId });
}

/**
 * Set a new password for the signed-in user.
 *
 * Answers with a fresh token pair, because the backend revokes every OTHER
 * session: the caller stays signed in here and is signed out everywhere else.
 * Store both, or this browser is next.
 *
 * A wrong current password comes back as a 400, deliberately not a 401 — the
 * transport reads a 401 as an expired access token and would burn a refresh and
 * replay with the same wrong password.
 */
export function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/change-password", {
    currentPassword,
    newPassword,
  });
}
