/**
 * Credentials come from `deck/.env` or the real environment, and from nowhere
 * else. They are never written back to disk and never appear in a log line.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DECK_ROOT } from './shot.mjs';

let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const text = readFileSync(path.join(DECK_ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key] === undefined) {
        process.env[key] = raw.trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env is fine — the values may come from the shell instead.
  }
}

export function env(key, fallback) {
  load();
  return process.env[key] ?? fallback;
}

/**
 * Reads one login. Throws a message that says exactly what to set rather than
 * failing later with an unexplained blank screenshot.
 */
export function credentials(role) {
  const prefix = `DECK_${role.toUpperCase()}`;
  const email = env(`${prefix}_EMAIL`);
  const password = env(`${prefix}_PASSWORD`);
  if (!email || !password) {
    throw new Error(
      `missing credentials for "${role}". Set ${prefix}_EMAIL and ${prefix}_PASSWORD ` +
        `in deck/.env (git-ignored) or in the environment.`,
    );
  }
  return { email, password };
}
