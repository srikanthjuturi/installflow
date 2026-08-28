import { apiGet, apiPatch, apiPost } from "./http";
import type {
  LoginResponse,
  MeResponse,
  PasswordResetRequestResponse,
  PasswordResetVerifyResponse,
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
 * Sign in with a Google ID token (`POST /auth/google`).
 *
 * The `credential` comes from Google Identity Services — both the button and
 * One Tap produce the same thing, so one function serves both. It is an
 * argument only: nothing here stores, logs or returns it.
 *
 * The reply is the same `LoginResponse` a password sign-in gives, so the
 * session store and routing need no special case. A 401 here means "no console
 * account uses that Google address", never an expired token — which is why
 * `/auth/google` is on the transport's `NO_REFRESH` list.
 */
export function loginWithGoogle(credential: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/google", { credential });
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

/**
 * Step 1 of a forgotten password — email a one-time code (`POST
 * /auth/password-reset/request`).
 *
 * Unauthenticated, like `/auth/login`: the whole premise is that the caller
 * cannot prove who they are yet. All three reset paths are on the transport's
 * `NO_REFRESH` list for that reason.
 *
 * An address with no console account is a **404**, deliberately — the
 * alternative leaves somebody who mistyped their own email on a code screen no
 * code will ever reach. A 429 carries `Retry-After` and a message naming the
 * wait; both are throttles the backend counts, not this client.
 */
export function requestPasswordReset(
  email: string
): Promise<PasswordResetRequestResponse> {
  return apiPost<PasswordResetRequestResponse>("/auth/password-reset/request", {
    email: email.trim(),
  });
}

/**
 * Step 2 — exchange the code for a reset ticket
 * (`POST /auth/password-reset/verify`).
 *
 * Burns the code, so a second call with the same one fails however right it
 * was. The `resetToken` is bearer-grade for its fifteen minutes: it is the only
 * thing standing between its holder and a new password, so it is kept in
 * component state and never persisted.
 */
export function verifyPasswordResetCode(
  email: string,
  code: string
): Promise<PasswordResetVerifyResponse> {
  return apiPost<PasswordResetVerifyResponse>("/auth/password-reset/verify", {
    email: email.trim(),
    code,
  });
}

/**
 * Step 3 — set the new password (`POST /auth/password-reset/confirm`).
 *
 * Answers with the same `LoginResponse` a sign-in gives, so the caller stores
 * the pair and is signed in: they proved the address a moment ago and a second
 * sign-in form would have nothing to establish. Every OTHER session is revoked.
 *
 * A spent, expired or superseded token is a **400**, not a 401 — the transport
 * reads a 401 as an expired access token, and this endpoint has no session to
 * refresh.
 */
export function confirmPasswordReset(
  resetToken: string,
  newPassword: string
): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/password-reset/confirm", {
    resetToken,
    newPassword,
  });
}
