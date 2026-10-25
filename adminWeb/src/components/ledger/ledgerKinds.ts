/**
 * What the pool screen knows about each ledger KIND — label, chip tone and the
 * pool's sign — pulled out of `LedgerTable` (Task 13 §5.1) so the lookups are
 * pure and tested, and so an unknown kind has exactly one place to fall back.
 *
 * Every lookup is an OWN-property read. A bare `table[kind]` finds
 * `Object.prototype` members, so a kind the API invented called `constructor`
 * would answer with a function and the amount column would print `NaN` — the
 * very failure this file exists to prevent.
 */

import type { LedgerEntry } from "@/types";

type Kind = LedgerEntry["kind"];

const has = (table: object, kind: string) =>
  Object.prototype.hasOwnProperty.call(table, kind);

/**
 * Static class strings, one per kind — an interpolated `bg-${kind}-bg` would
 * never be generated. A kind with no entry falls to the neutral tone.
 */
const KIND_CHIP: Readonly<Record<string, string>> = {
  penalty: "bg-danger-bg text-danger",
  bonus: "bg-ok-bg text-ok",
  // Money out of the pool like a bonus, but not a bonus — its own tone so the
  // two are never read as one.
  reversal: "bg-info-bg text-info",
  // Task 11's two speed kinds. No new hex or token is invented for either —
  // both borrow the semantic tones the pool screen already trusts, and the
  // LABEL is what actually separates each from the kind it shares a colour
  // with. A speed reward is money out like a bonus (W7: it is paid even when
  // the pool is short), and a speed penalty is money in like a cancellation
  // penalty — and, like one, it can be given back.
  speed_reward: "bg-ok-bg text-ok",
  speed_penalty: "bg-danger-bg text-danger",
};
const KIND_CHIP_FALLBACK = "bg-surface-3 text-ink-2";

/**
 * The wire value is lower case; the column prints the approved label. An
 * unknown kind prints ITSELF — a fallback word could be mistaken for an
 * approved one. "Speed reward" / "Speed penalty" are the strings the API's
 * Earnings `_title` writes, so the two screens never name the same money twice.
 */
const KIND_LABEL: Readonly<Record<string, string>> = {
  penalty: "Penalty",
  bonus: "Bonus",
  reversal: "Penalty reversed",
  speed_reward: "Speed reward",
  speed_penalty: "Speed penalty",
};

/**
 * Which way each kind moves the POOL — this screen's point of view, and the one
 * "Current pool balance" is the sum of. A penalty is collected into the pool;
 * a bonus is paid out of it; a reversal gives a penalty back, so that money
 * leaves the pool too. The speed circuit shares the balance: a reward is paid
 * OUT, a penalty collected IN.
 */
const POOL_SIGN: Readonly<Record<string, 1 | -1>> = {
  penalty: 1,
  bonus: -1,
  reversal: -1,
  speed_reward: -1,
  speed_penalty: 1,
};

/** Every kind this build can draw, in the order the Type filter offers them. */
export const LEDGER_KINDS = [
  "penalty",
  "bonus",
  "reversal",
  "speed_reward",
  "speed_penalty",
] as const satisfies readonly Kind[];

export const kindLabel = (kind: Kind): string =>
  has(KIND_LABEL, kind) ? KIND_LABEL[kind] : kind;

export const kindChip = (kind: Kind): string =>
  has(KIND_CHIP, kind) ? KIND_CHIP[kind] : KIND_CHIP_FALLBACK;

/**
 * +1 into the pool, −1 out. A kind this build has never heard of reads as
 * collected (+1) — never `NaN`, never `undefined`.
 */
export const poolSign = (kind: Kind): 1 | -1 =>
  has(POOL_SIGN, kind) ? POOL_SIGN[kind] : 1;

/** True when the console recognises the kind (so a sign may be coloured). */
export const isKnownKind = (kind: Kind): boolean => has(POOL_SIGN, kind);
