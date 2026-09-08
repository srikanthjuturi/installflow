/**
 * Deterministic PII pseudonymiser for deck screenshots.
 *
 * We capture against the PRODUCTION database, so real customers' names, phones
 * and street addresses would otherwise land on a slide shown to a prospect. This
 * rewrites them in the API RESPONSE, before either client ever sees them —
 * rather than scrubbing the rendered DOM, which would have to be re-taught every
 * selector on every screen and would silently miss the one it did not know.
 *
 * Deterministic, not random: the same real value always maps to the same fake,
 * so one customer reads as the same person on every slide and a re-run produces
 * the same deck. The seed is a hash of the value itself, never a counter.
 *
 * What is NOT masked, deliberately:
 *   - city / state / pincode. Geography, not a person. A pincode covers
 *     thousands of households, and the territory, escalation and coverage
 *     screens are worth nothing without it.
 *   - Anything already carrying '•'. That is the PRODUCT's own masking of an
 *     unaccepted job (`mask_name` in api/app/features/jobs/service.py) — a
 *     feature we want on the slide. Pseudonymising it into a full name would
 *     erase exactly the thing the offer screen exists to demonstrate.
 */

/** FNV-1a. Small, stable across runs and processes — which `Math.random` is not. */
function hash(value) {
  let h = 0x811c9dc5;
  const s = String(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A second, decorrelated draw from one seed, so first and last name do not move together. */
const pick = (list, seed) => list[seed % list.length];

const FIRST = [
  'Aarav', 'Ananya', 'Rohit', 'Meera', 'Vikram', 'Priya', 'Karthik', 'Divya',
  'Sanjay', 'Nisha', 'Arjun', 'Kavya', 'Rahul', 'Sneha', 'Imran', 'Fatima',
  'Suresh', 'Lakshmi', 'Nikhil', 'Pooja', 'Farhan', 'Anjali', 'Manish', 'Ritu',
];

const LAST = [
  'Sharma', 'Iyer', 'Reddy', 'Nair', 'Patel', 'Desai', 'Menon', 'Rao',
  'Gupta', 'Chauhan', 'Pillai', 'Bose', 'Khan', 'Joshi', 'Kulkarni', 'Verma',
];

const STREET = [
  'Anand Nagar', 'MG Road', 'Green Park', 'Sunrise Colony', 'Lake View Road',
  'Gandhi Bazaar', 'Rose Garden Layout', 'Shanti Enclave', 'Palm Grove',
  'Nehru Cross', 'Ashoka Avenue', 'Silver Oak Residency',
];

/**
 * True when a value is the product's own mask. `mask_name` renders a fixed four
 * bullets per word, so any bullet at all means "this job has not been accepted
 * yet" — leave it exactly as the server wrote it.
 */
const isProductMasked = (value) => typeof value === 'string' && value.includes('•');

function fakeName(real) {
  const seed = hash(real);
  return `${pick(FIRST, seed)} ${pick(LAST, hash(`last:${real}`))}`;
}

function fakePhone(real) {
  // Five deterministic digits behind a stable example prefix. The shape of the
  // input is preserved, because the console formats a bare 10-digit string
  // differently from an E.164 one and a deck should show the real formatting.
  const tail = String(hash(`phone:${real}`) % 100000).padStart(5, '0');
  const digits = `987654${tail}`.slice(0, 10);
  return String(real).trim().startsWith('+') ? `+91${digits}` : digits;
}

function fakeAddress(real) {
  const seed = hash(`addr:${real}`);
  const number = (seed % 180) + 1;
  const cross = (hash(`cross:${real}`) % 12) + 1;
  return `${number}, ${pick(STREET, seed)}, ${cross}th Cross`;
}

/** ~±500 m. Enough that the ticket-detail marker still lands in the right
 *  neighbourhood of the right city, and nowhere near a specific front door. */
function jitter(value, salt) {
  const offset = ((hash(`${salt}:${value}`) % 1000) - 500) / 100000;
  return Number((Number(value) + offset).toFixed(6));
}

const RULES = {
  customerName: (v) => (isProductMasked(v) ? v : fakeName(v)),
  customerPhone: (v) => (isProductMasked(v) ? v : fakePhone(v)),
  address: (v) => (isProductMasked(v) ? v : fakeAddress(v)),
  addressLine: (v) => (isProductMasked(v) ? v : fakeAddress(v)),
  latitude: (v) => jitter(v, 'lat'),
  longitude: (v) => jitter(v, 'lng'),
};

/**
 * Rewrite every masked field anywhere in the tree, in place.
 *
 * Returns `{ count, originals }`. `count` is what the runner asserts on — a
 * ticket response that rewrote nothing means the field names moved and we are
 * one silent step from shipping a real customer's phone number on a slide.
 * `originals` is what the caller re-checks the serialised body against, so a
 * value that survives in some field we did not know about fails the run rather
 * than reaching a screenshot.
 *
 * `originals` stays in memory and is never logged or written to disk — it is
 * the real PII, and a file of it would be its own liability.
 */
export function maskTree(node) {
  let count = 0;
  const originals = [];

  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, current] of Object.entries(value)) {
      const rule = RULES[key];
      if (rule && current !== null && current !== undefined && current !== '') {
        const next = rule(current);
        if (next !== current) {
          value[key] = next;
          count += 1;
          // Numbers are jittered, not replaced — a latitude's old value sharing
          // a prefix with its new one is expected, so only strings are worth
          // hunting for in the output.
          if (typeof current === 'string' && current.length > 3) originals.push(current);
        }
      } else {
        walk(current);
      }
    }
  };

  walk(node);
  return { count, originals };
}

/** Exported for the verification step: what the deck must never contain. */
export const maskFieldNames = Object.keys(RULES);
