import Constants from 'expo-constants';

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
  body?: unknown;
  /** Bearer token. Callers pass it explicitly — see `request` in the store. */
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, token, signal }: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
