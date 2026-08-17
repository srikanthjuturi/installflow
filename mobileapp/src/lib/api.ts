import Constants from 'expo-constants';

import { getAccessToken, getRefreshToken, useSession } from '@/store/session.store';

/**
 * HTTP transport for the FastAPI backend.
 *
 * Every endpoint answers in the same envelope the console speaks —
 * `{ success, statusCode, message, data, errors }` — so `unwrap` is the only
 * place that shape is known.
 *
 * The base URL is NOT localhost by default. A phone running Expo Go resolves
 * `localhost` to itself, not to the laptop serving the API, so the default is
 * derived from the Metro host the app was loaded from — which is already the
 * laptop's LAN address. Override with EXPO_PUBLIC_API_URL when the API lives
 * somewhere else.
 */
function inferBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  // e.g. "192.168.1.5:8081" while Metro is serving the bundle.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:8000/api/v1`;

  return 'http://localhost:8000/api/v1';
}

export const API_BASE_URL = inferBaseUrl();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T | null;
  errors: string[];
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON by default; a `FormData` is sent as multipart instead. */
  body?: unknown;
  /** Bearer token. Callers pass it explicitly — see `request` in the store. */
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, token, signal }: RequestOptions = {},
): Promise<T> {
  // A file upload is multipart, and its Content-Type carries a boundary only
  // fetch can generate — setting the header ourselves would corrupt it.
  const multipart = body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch {
    // A field technician loses signal constantly. This has to read as
    // "you are offline", not as a server fault.
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope?.success) {
    throw new ApiError(
      envelope?.message ?? `Request failed (${response.status})`,
      response.status,
      envelope?.errors ?? [],
    );
  }

  return envelope.data as T;
}

/**
 * One refresh at a time, shared by every caller that hit a 401.
 *
 * The server ROTATES refresh tokens: presenting one revokes it. So if three
 * screens refetch at once and all three 401, three parallel refreshes would
 * see the first succeed and the other two present an already-revoked token —
 * and a technician mid-job would be signed out for no reason. Everyone waits
 * on the same promise instead.
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
      // The endpoint is spelled here rather than imported from
      // features/auth/api/session.ts, which imports this module — the cycle
      // would break Metro's module graph.
      const next = await apiRequest<{ accessToken: string; refreshToken: string }>(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken } },
      );
      useSession.getState().setTokens(next);
      return next.accessToken;
    } catch {
      // Expired, revoked, or the account was deactivated. Not recoverable.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * A request as the signed-in technician, with one automatic retry.
 *
 * Access tokens last 30 minutes. Without this, an app left open through a
 * single job stops working with no explanation and no way back except killing
 * it — so every authenticated call goes through here, not `apiRequest`.
 *
 * A 401 that survives the refresh means the session is genuinely gone, so the
 * store is cleared and the `(app)` guard redirects to sign-in on its own.
 */
export async function authedRequest<T>(
  path: string,
  options: Omit<RequestOptions, 'token'> = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, { ...options, token: getAccessToken() });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;

    const fresh = await refreshAccessToken();
    if (!fresh) {
      useSession.getState().signOut();
      throw new ApiError('Your session has ended. Please sign in again.', 401);
    }
    return apiRequest<T>(path, { ...options, token: fresh });
  }
}
