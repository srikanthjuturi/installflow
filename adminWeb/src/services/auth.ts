import { apiGet, apiPost } from "./http";
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

/** Re-scope the session to another company the caller belongs to. */
export function switchCompany(
  companyId: string
): Promise<SwitchCompanyResponse> {
  return apiPost<SwitchCompanyResponse>("/auth/switch-company", { companyId });
}
