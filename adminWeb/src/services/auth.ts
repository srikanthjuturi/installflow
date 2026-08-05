import { mockResponse } from "./client";
import { API_ROLE, type AuthPayload, type AuthUser } from "@/types/api";

/**
 * Sign-in, against the real envelope.
 *
 * Two steps, because ops staff have a password and the OTP is a second factor.
 * (The technician app is OTP-only — different actor, different rules.) Both
 * endpoints answer with the backend's `AuthPayload` — `{ accessToken, user }`
 * — so binding later replaces the bodies below and nothing above them moves.
 *
 * The password and the OTP code are **arguments only**. Nothing here stores,
 * logs, echoes or returns either, and neither ever reaches the session store.
 */

/**
 * The served account, shaped exactly like the backend's sample `data` block.
 *
 * ⚠ `role: 1` is ADMIN — the one confirmed code — while the console's own user
 * directory lists this same address as an ASM. The contract has no field for
 * the *scope* (region / area) that the console displays beside a role, so the
 * two records can disagree until the backend serves one.
 */
const SEED_ACCOUNT: AuthUser = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  email: "ravi.sharma@installflow.in",
  name: "Ravi Sharma",
  role: API_ROLE.ADMIN,
  createdAt: "2024-03-11T09:12:44.000Z",
  lastLoginAt: "2026-08-04T18:22:07.000Z",
  loginCount: 128,
};

/** Advances across sign-ins so `lastLoginAt` and `loginCount` are real. */
let account: AuthUser = SEED_ACCOUNT;

/**
 * The address the credentials step was submitted with, held between the two
 * steps. In memory only: reloading mid-flow starts the sign-in over, which is
 * what a real challenge would do.
 */
let pendingEmail: string | null = null;

/**
 * Opaque stand-in for the JWT the backend mints. Nothing in the console parses
 * the token — it is a bearer string that goes in a header — so a random value
 * is a faithful substitute and can never be mistaken for a real credential.
 */
function issueToken(): string {
  // `crypto.randomUUID` needs a secure context, which a console demoed over
  // plain HTTP on a LAN would not have.
  const webCrypto = globalThis.crypto as Crypto | undefined;
  const id =
    typeof webCrypto?.randomUUID === "function"
      ? webCrypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return `mock.${id}`;
}

/**
 * Step 1 — credentials.
 *
 * Real credentials do not exist yet, so any pair succeeds; the backend is what
 * will reject a wrong one, with its own message in the envelope's `errors[]`.
 * The payload it answers with is **unverified**: the console deliberately
 * stores none of it until the second factor passes.
 */
export function login(email: string, password: string): Promise<AuthPayload> {
  return mockResponse(() => {
    // Read and dropped on the same line. It is never assigned, captured or
    // returned, so there is nothing holding it after this call.
    void password;

    pendingEmail = email.trim().toLowerCase();
    return {
      accessToken: issueToken(),
      user: { ...account, email: pendingEmail },
    };
  });
}

/**
 * Step 2 — the one-time code. Its payload is the session.
 *
 * The code is not checked here: faking a comparison would encode a rule the
 * backend owns, and any six digits pass in the approved prototype.
 */
export function verifyOtp(code: string): Promise<AuthPayload> {
  return mockResponse(() => {
    void code;

    const email = pendingEmail ?? account.email;
    pendingEmail = null;

    const previous = account;
    account = {
      ...previous,
      email,
      lastLoginAt: new Date().toISOString(),
      loginCount: previous.loginCount + 1,
    };

    // "Last login" means the one *before* this one — the session you are in
    // right now is not history yet. A fresh token, too: the one issued beside
    // the credentials step never becomes a session.
    return {
      accessToken: issueToken(),
      user: { ...account, lastLoginAt: previous.lastLoginAt },
    };
  });
}
