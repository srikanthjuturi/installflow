/**
 * A thin client for the API, plus the safety rail that keeps this pointed at
 * development.
 *
 * Everything the seeder does goes through the real endpoints — no direct SQL.
 * That is the point: the API stamps both prices and the rules snapshot at
 * intake, writes a `ticket_events` row in the same transaction as the change it
 * describes, and enforces every invariant. Data inserted behind its back would
 * look right on a screen and be wrong underneath.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../capture/lib/shot.mjs';

export const BASE = process.env.DECK_DEV_API ?? 'http://127.0.0.1:8000/api/v1';
export const ORIGIN = BASE.replace(/\/api\/v1$/, '');

/** True when the seeder is talking to an API on this machine. */
export const IS_LOCAL_API = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(BASE);

/**
 * Hosts that serve `RelianceProdDB`. Refused outright, whatever else is set.
 *
 * A denylist is worthless on its own — it can only ever name the production
 * addresses somebody thought of. It is here as a second floor under the opt-in
 * below, not as the guard itself.
 */
const PRODUCTION_HOSTS = [/^installflowapi-bqh6d9e2hhaedye0\./i];

/**
 * Refuse to run against anything but a development database.
 *
 * The seeder creates and, with `--reset`, DELETES a whole company. Originally
 * that was guarded by requiring a loopback address, on the reasoning that a
 * remote hostname cannot be verified as development from outside — which is
 * still true, and is why the remote door is an explicit opt-in rather than a
 * relaxation.
 *
 * Local: unchanged. The address has to be loopback AND `api/.env` — what an
 * un-overridden local API actually reads — must not name a production database.
 *
 * Remote: `DECK_ALLOW_REMOTE_SEED` has to name the EXACT hostname being
 * seeded. Nothing is inferred and no wildcard is accepted, so this cannot
 * happen because a URL was left in a shell an hour ago; somebody has to type
 * the host they mean, twice, in two different variables. The known production
 * hosts are refused even then.
 */
export function assertDevelopment() {
  const host = new URL(BASE).hostname;

  if (PRODUCTION_HOSTS.some((pattern) => pattern.test(host))) {
    throw new Error(
      `${host} serves production. The seeder writes and deletes whole companies ` +
        `and will not run against it under any setting.`,
    );
  }

  if (!IS_LOCAL_API) {
    const allowed = process.env.DECK_ALLOW_REMOTE_SEED;
    if (allowed !== host) {
      throw new Error(
        `refusing to seed ${BASE}.\n` +
          `     The seeder is for a LOCAL development API. To aim it at a remote\n` +
          `     DEVELOPMENT api anyway, set DECK_ALLOW_REMOTE_SEED to exactly:\n` +
          `       ${host}\n` +
          `     Be certain that host reads a development database — nothing here\n` +
          `     can check it for you.`,
      );
    }
    return host;
  }

  const envPath = path.join(REPO_ROOT, 'api', '.env');
  const text = readFileSync(envPath, 'utf8');
  const database = /^POSTGRES_DB\s*=\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  if (!database) throw new Error(`could not read POSTGRES_DB from ${envPath}`);
  if (/prod/i.test(database)) {
    throw new Error(
      `api/.env names ${database}. The seeder writes a whole company and will not ` +
        `run against production.`,
    );
  }
  return database;
}

export class ApiError extends Error {
  constructor(method, pathname, status, payload) {
    const detail = payload?.message ?? payload?.detail ?? JSON.stringify(payload).slice(0, 300);
    // The envelope carries the useful part in `errors`; a bare "Validation
    // failed" says nothing about which field the server actually objected to.
    const errors = payload?.errors;
    const fields = errors ? JSON.stringify(errors).slice(0, 600) : '';
    super(`${method} ${pathname} → ${status}: ${detail}${fields ? `\n     ${fields}` : ''}`);
    this.status = status;
    this.payload = payload;
  }
}

/** One call. `token` omitted means unauthenticated. */
export async function call(pathname, { token, method = 'GET', body, form, raw = false } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;

  let payload;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const url = pathname.startsWith('http')
    ? pathname
    : `${pathname.startsWith('/api/') ? ORIGIN : BASE}${pathname}`;

  let response;
  try {
    response = await fetch(url, { method, headers, body: payload });
  } catch (cause) {
    // Node's bare "fetch failed" names neither the URL nor the reason.
    throw new Error(`${method} ${url} — ${cause.cause?.message ?? cause.message}`, { cause });
  }

  if (raw) {
    const text = await response.text();
    if (!response.ok) throw new ApiError(method, pathname, response.status, { detail: text.slice(0, 200) });
    return text;
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(method, pathname, response.status, json);
  return json.data;
}

/** Multipart upload — the only endpoint that does not take JSON. */
export async function upload(token, bytes, filename, contentType, kind) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  const response = await fetch(`${BASE}/uploads${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError('POST', '/uploads', response.status, json);
  return json.data;
}

export async function login(email, password) {
  const data = await call('/auth/login', { method: 'POST', body: { email, password } });
  return data.accessToken;
}

/**
 * Sign in with the temporary password the API just handed back, then set the
 * shared demo one. `/auth/change-password` is the only way to choose it — the
 * server generates every initial password and never accepts one on create.
 */
export async function adoptPassword(email, temporaryPassword, newPassword) {
  const token = await login(email, temporaryPassword);
  await call('/auth/change-password', {
    token,
    method: 'POST',
    body: { currentPassword: temporaryPassword, newPassword },
  });
  return login(email, newPassword);
}

/**
 * A technician has no password — the phone is the credential. With
 * `OTP_DEV_ECHO` on (the local default) the code comes back in the response,
 * and the WhatsApp allowlist drops the send, so nobody is messaged.
 */
export async function technicianLogin(phone) {
  const requested = await call('/auth/otp/request', { method: 'POST', body: { phone } });
  const code = requested?.devCode;
  if (!code) {
    throw new Error(
      `no devCode for ${phone}. OTP_DEV_ECHO must be on — it is the default in ` +
        `app/core/config.py and api/.env does not override it.`,
    );
  }
  const verified = await call('/auth/otp/verify', { method: 'POST', body: { phone, code } });
  return verified.accessToken;
}
