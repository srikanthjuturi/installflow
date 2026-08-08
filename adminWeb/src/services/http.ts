/**
 * Real HTTP transport for the live FastAPI backend.
 *
 * The mock `client.ts` stays for the ops-console demo; this is the seam the
 * superadmin (companies) module talks through. Every backend endpoint returns
 * the same `{ success, statusCode, message, data, errors }` envelope the mock
 * builds, so `unwrap` / `unwrapPage` are reused verbatim — only the transport
 * differs (fetch instead of a timeout).
 */

import { useSession } from "@/store/session";
import type {
  ApiEnvelope,
  ListParams,
  Page,
  PaginatedEnvelope,
} from "@/types/api";
import { ApiError, unwrap, unwrapPage } from "./client";

/** Base URL of the API. Override with `VITE_API_BASE_URL` in an `.env`. */
const BASE_URL = (
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

async function request<T>(
  method: Method,
  path: string,
  body?: unknown
): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network-level failure: server down, wrong port, CORS blocked outright.
    throw new ApiError(
      "Cannot reach the server. Is the API running on " + BASE_URL + "?",
      0
    );
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
  throw new ApiError(res.statusText || "Unexpected response", res.status || 500);
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

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return unwrap(await request<T>("PUT", path, body ?? {}));
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return unwrap(await request<T>("PATCH", path, body ?? {}));
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return unwrap(await request<T>("DELETE", path, body));
}
