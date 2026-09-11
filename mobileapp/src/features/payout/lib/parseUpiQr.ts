/**
 * A UPI ID read back out of a payment QR — so a technician can SCAN the
 * address their bank already printed for them instead of typing it.
 *
 * It is the worst string in the product to type: long, never read, and a
 * wrong character that still has the right shape sends their money to a
 * stranger for good. A camera removes the keyboard from that path.
 *
 * "A UPI QR" is two different things, and both are handled:
 *
 *   1. **A `upi://pay?pa=…&pn=…` link**, printed by payment apps — sometimes
 *      under their own scheme (`phonepe://`). Only the query matters, so the
 *      scheme is ignored. `pa` is the address, `pn` the name.
 *   2. **An EMVCo / BharatQR payload**, printed by banks: nested
 *      `tag + 2-digit length + value` fields. The address sits in a merchant
 *      account template (tags 02–51), and which one and which sub-tag varies by
 *      issuer, so EVERY sub-value is tested against the address shape. Tag 59
 *      is the name.
 *
 * A bare `name@bank` is accepted too — a few generators encode nothing else.
 *
 * Mirrors `parse_upi_qr` in the integration guide the flow was built from;
 * nothing server-side decodes images, so it lives only here.
 */

/**
 * The server's own rule (`api/app/core/upi.py`), on the lowercased value.
 * Kept identical so a scan the app accepts is never a 400 on Save.
 */
const VPA = /^[a-z0-9][a-z0-9._-]{1,48}@[a-z][a-z0-9]{1,29}$/;

/** Longest payee name kept — anything longer is not a name a UPI app shows. */
const PAYEE_MAX = 80;

export interface ScannedUpi {
  vpa: string;
  /** The name printed with it, when the code carried one. */
  name: string | null;
}

/** Trim, lowercase, drop spaces; null for anything not shaped like a UPI ID. */
export function normaliseVpa(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, '');
  return VPA.test(cleaned) ? cleaned : null;
}

/**
 * The query of a link, decoded by hand.
 *
 * Not `URLSearchParams`: React Native's is a partial polyfill whose `get`
 * throws on some versions, and this runs on a live camera callback where a
 * throw is a frozen scanner.
 */
function queryOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const query = text.slice(text.indexOf('?') + 1).split('#')[0] ?? '';
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1).replace(/\+/g, ' ');
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // A stray `%` in somebody's shop name. Keep the raw text rather than
      // losing the field — the address is what matters, and it has no `%`.
    }
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/**
 * Walk an EMVCo `id + 2-digit length + value` string.
 *
 * Stops at the first thing that is not a tag, so a payload that is not EMV at
 * all yields [] — which is how the formats are told apart without guessing
 * from the first characters.
 */
function emvTags(s: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const length = s.slice(i + 2, i + 4);
    if (!/^\d\d$/.test(length)) return out;
    const n = Number(length);
    if (i + 4 + n > s.length) return out;
    out.push([tag, s.slice(i + 4, i + 4 + n)]);
    i += 4 + n;
  }
  return out;
}

/** The UPI ID (and name) in a scanned payload, or null for "not a payment QR". */
export function parseUpiQr(payload: string | null | undefined): ScannedUpi | null {
  const text = (payload ?? '').trim();
  if (!text) return null;

  // 1. upi://pay?pa=…&pn=…  (and every app-specific scheme)
  if (text.includes('?')) {
    const q = queryOf(text);
    const vpa = normaliseVpa(q.get('pa'));
    if (vpa) {
      const name = (q.get('pn') ?? '').trim().slice(0, PAYEE_MAX);
      return { vpa, name: name || null };
    }
  }

  // 2. EMVCo / BharatQR — a bank's printed payload
  const tags = emvTags(text);
  // One tag is any string starting with two digits and a plausible length;
  // two is the least that looks like a real payload.
  if (tags.length >= 2) {
    let vpa: string | null = null;
    let name: string | null = null;
    for (const [tag, value] of tags) {
      const id = Number(tag);
      if (vpa === null && /^\d\d$/.test(tag) && id >= 2 && id <= 51) {
        for (const [, sub] of emvTags(value)) {
          const candidate = normaliseVpa(sub);
          if (candidate) {
            vpa = candidate;
            break;
          }
        }
      }
      if (name === null && tag === '59') name = value.trim().slice(0, PAYEE_MAX) || null;
    }
    if (vpa) return { vpa, name };
  }

  // 3. a bare address
  const vpa = normaliseVpa(text);
  return vpa ? { vpa, name: null } : null;
}
