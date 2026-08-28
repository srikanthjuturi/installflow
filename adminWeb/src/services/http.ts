/**
 * Real HTTP transport for the live FastAPI backend.
 *
 * The mock `client.ts` stays for the ops-console demo; this is the seam the
 * superadmin (companies) module talks through. Every backend endpoint returns
 * the same `{ success, statusCode, message, data, errors }` envelope the mock
 * builds, so `unwrap` / `unwrapPage` are reused verbatim — only the transport
 * differs (fetch instead of a timeout).
 */

// The browser half only — `lib/webPush` imports nothing, so this cannot
// re-enter the transport the way `services/notifications` would.
import { unsubscribe } from "@/lib/webPush";
import { useSession } from "@/store/session";
import type {
  ApiEnvelope,
  ListParams,
  Page,
  PaginatedEnvelope,
  RefreshResponse,
} from "@/types/api";
import { ApiError, unwrap, unwrapPage } from "./client";

/** Base URL of the API. Override with `VITE_API_BASE_URL` in an `.env`. */
export const BASE_URL = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:8000/api/v1"
).replace(/\/+$/, "");

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function authHeaders(): Record<string, string> {
  const token = useSession.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Encode the shared list params (+ flattened filters) into a query string. */
function queryString(params: ListParams = {}): string {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.search) sp.set("search", params.search);
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  for (const [k, v] of Object.entries(params.filters ?? {})) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* ------------------------------------------------------- token refreshing */

/**
 * The access token lives 30 minutes; the refresh token lives 7 days. Rather
 * than watch the clock, the transport reacts: a 401 triggers one refresh and
 * the original request is replayed. The screens above never see it.
 *
 * The refresh call is made with a bare `fetch` on purpose — routing it through
 * `request` would let a 401 on `/auth/refresh` trigger another refresh, and
 * putting it in `services/auth.ts` would make that module and this one import
 * each other.
 */
const REFRESH_PATH = "/auth/refresh";

/**
 * Paths that must never trigger a refresh-and-replay.
 * - `/auth/refresh`: a failed refresh is the end of the session, not a retry.
 * - `/auth/login`: its 401 means *wrong password*. Replaying it after
 *   refreshing a leftover session would send the bad credentials twice.
 * - `/auth/logout`: the session is being torn down anyway. Refreshing first
 *   would rotate the token, leaving the request body holding the one that was
 *   just revoked — the server would then revoke nothing. The local session is
 *   cleared regardless, and the untouched token ages out.
 */
const NO_REFRESH = new Set([REFRESH_PATH, "/auth/login", "/auth/logout"]);

/**
 * A dead access token fails every in-flight request at once. Without this, a
 * screen with six queries would fire six refreshes — and since the backend
 * rotates on use, five of them would present an already-revoked token and kill
 * the session. One refresh, shared by all waiters.
 */
let refreshInFlight: Promise<boolean> | null = null;

/** Wipes the session and sends the user to sign in again. */
function endSession(): void {
  // Locally only, and deliberately not awaited. The token is already dead, so
  // `DELETE /notifications/web-devices` would 401 — but dropping the browser's
  // own subscription is enough: the push service then answers 410 and the
  // server prunes the row on its next attempt. Without this, a session that
  // expired rather than being signed out keeps receiving notification text on
  // a machine nobody is signed in on.
  void unsubscribe().catch(() => {});
  useSession.getState().signOut();
  // A hard navigation, not a router push: it drops the query cache and every
  // other in-memory trace of the previous identity.
  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

async function performRefresh(): Promise<boolean> {
  const token = useSession.getState().refreshToken;
  // Nothing to renew with (a mock session, or already signed out) — let the
  // caller's 401 surface as it did before.
  if (!token) return false;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${REFRESH_PATH}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken: token }),
    });
  } catch {
    // The server is unreachable, which says nothing about the token. Keep the
    // session; the original request reports the network failure.
    return false;
  }

  if (!res.ok) {
    // Only an auth failure means the token itself is dead — revoked, expired
    // or belonging to a disabled user. A 500 or a proxy error says nothing
    // about it, so the session survives and the original call reports.
    if (res.status === 401 || res.status === 403) endSession();
    return false;
  }

  try {
    const json = (await res.json()) as ApiEnvelope<RefreshResponse>;
    const next = unwrap(json);
    if (!next?.accessToken || !next?.refreshToken) return false;
    useSession.getState().setTokens(next);
    return true;
  } catch {
    // A 200 that isn't the envelope. Nothing to store, but nothing that proves
    // the session is over either.
    return false;
  }
}

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/* ------------------------------------------------------------- the request */

/** One attempt. `authHeaders` is read here so a replay picks up a new token. */
async function send(
  method: Method,
  path: string,
  body?: unknown
): Promise<Response> {
  // A file upload is multipart, and its Content-Type carries a boundary only
  // the browser can generate — setting the header ourselves would corrupt it.
  const multipart = body instanceof FormData;
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined && !multipart
          ? { "Content-Type": "application/json" }
          : {}),
        ...authHeaders(),
      },
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
    });
  } catch {
    // Network-level failure: server down, wrong port, CORS blocked outright.
    throw new ApiError(
      "Cannot reach the server. Is the API running on " + BASE_URL + "?",
      0
    );
  }
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown
): Promise<ApiEnvelope<T>> {
  let res = await send(method, path, body);

  // Exactly one replay: if the second attempt also 401s, the token is not the
  // problem and the envelope's own message is what the user needs to read.
  if (res.status === 401 && !NO_REFRESH.has(path.split("?")[0])) {
    if (await refreshSession()) {
      res = await send(method, path, body);
    }
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON (e.g. an HTML error page) — surface the HTTP status instead.
  }

  if (
    json &&
    typeof json === "object" &&
    "success" in json &&
    typeof (json as ApiEnvelope<T>).success === "boolean"
  ) {
    return json as ApiEnvelope<T>;
  }
  throw new ApiError(
    res.statusText || "Unexpected response",
    res.status || 500
  );
}

export async function apiGet<T>(path: string): Promise<T> {
  return unwrap(await request<T>("GET", path));
}

export async function apiGetPage<T>(
  path: string,
  params: ListParams = {}
): Promise<Page<T>> {
  const env = (await request<T[]>(
    "GET",
    `${path}${queryString(params)}`
  )) as PaginatedEnvelope<T>;
  return unwrapPage(env);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return unwrap(await request<T>("POST", path, body ?? {}));
}

/**
 * Multipart POST. Goes through `request`, so a 401 still refreshes and replays
 * — a FormData body can be sent twice, the browser re-reads the file.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return unwrap(await request<T>("POST", path, form));
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return unwrap(await request<T>("PUT", path, body ?? {}));
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return unwrap(await request<T>("PATCH", path, body ?? {}));
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return unwrap(await request<T>("DELETE", path, body));
}
