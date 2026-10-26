/**
 * The pincode-range grammar, in the browser.
 *
 * The server (`api/app/core/pincode_ranges.py`) is the ONLY authority on what
 * will be stored — this file exists so the console can refuse to send a request
 * the server would 422, and so the preview can summarise a `PincodeChange`
 * without the dialog re-reading the wire shape. It must never accept anything
 * the grammar rejects or reject anything it accepts… with one deliberate
 * exception: the server can do more (NFKC normalisation, a 20k-char ceiling,
 * a span ceiling) and this only checks enough to keep obviously-dead requests
 * off the wire.
 *
 * Pure and DOM-free, so `pincodeRanges.test.ts` exercises it with nothing else
 * on screen (X1).
 */

import type { PincodeChange } from "@/types/franchisee";

export type RangeCheck =
  | { ok: true; entries: number; span: number }
  | {
      ok: false;
      reason: "bad-token" | "backwards" | "too-many" | "empty";
      /** The entry that offended — named in the field's error. */
      token?: string;
    };

/** Six digits not starting with zero — must equal the server's `PINCODE_RE`. */
const SIX_RE = /^[1-9][0-9]{5}$/;
/** Two pincodes joined by a plain or en dash, optional spaces around it. */
const RANGE_RE = /^([0-9]+)\s*[-–]\s*([0-9]+)$/;

const MAX_TOKENS = 500;

/**
 * Is the text grammar-clean, and how much does it cover?
 *
 * An empty (or whitespace-only) box is NOT an error — it is "hand everything
 * back", which the server treats as a real answer, so it reports `empty` and
 * the dialog lets the preview run on it. A token that fails either pattern is
 * ONE `bad-token` naming the first offender; that is all the field error needs.
 */
export function checkRangeSyntax(text: string): RangeCheck {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const entries = trimmed
    .normalize("NFKC")
    .split(/[,;\r\n]+/)
    .filter((e) => e.trim());
  if (entries.length > MAX_TOKENS) return { ok: false, reason: "too-many" };

  const merged: Array<[number, number]> = [];
  for (const raw of entries) {
    const entry = raw.trim();
    const range = RANGE_RE.exec(entry);
    if (range) {
      const [, from, to] = range;
      if (!SIX_RE.test(from) || !SIX_RE.test(to)) {
        return { ok: false, reason: "bad-token", token: entry };
      }
      if (Number(from) > Number(to)) {
        return { ok: false, reason: "backwards", token: entry };
      }
      merged.push([Number(from), Number(to)]);
      continue;
    }
    if (!SIX_RE.test(entry)) {
      return { ok: false, reason: "bad-token", token: entry };
    }
    merged.push([Number(entry), Number(entry)]);
  }

  // Overlapping, adjacent and repeated runs merge — the server does it, and
  // the span is what makes the count honest for the preview's summary.
  //
  // Merge into RUNS first, then sum the runs. The span is the count of
  // DISTINCT codes, so a run extended by a later merge must be measured by its
  // final end — summing per entry at merge time (the obvious loop) quietly
  // drops whatever the last entry overlapped away: `500001-500010,
  // 500005-500020` would read as 10 instead of 20, and the summary would
  // under-count every handover by the overlap.
  merged.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const runs: Array<[number, number]> = [];
  for (const [from, to] of merged) {
    const run = runs[runs.length - 1];
    if (run && from <= run[1] + 1) run[1] = Math.max(run[1], to);
    else runs.push([from, to]);
  }
  return {
    ok: true,
    entries: merged.length,
    span: runs.reduce((sum, [from, to]) => sum + (to - from) + 1, 0),
  };
}

/**
 * The text as the server would think of it: separators unified to ", ", dashes
 * to "-", entries trimmed. This is what keys the preview query, so retyping
 * `500040` as ` 500040 ` does not fetch a second plan for the same list.
 */
export function normaliseRangeText(text: string): string {
  return text
    .normalize("NFKC")
    .split(/[,;\r\n]+/)
    .filter((e) => e.trim())
    .map((raw) => raw.trim().replace(/\s*[-–]\s*/g, "-"))
    .join(", ");
}

/* ── the preview, summarised ─────────────────────────────────────────────── */

/** The impact of one plan, so the dialog's two phases can both read it. */
export function previewImpact(p: PincodeChange): {
  moved: number;
  trimmed: number;
  tickets: number;
  any: boolean;
} {
  const moved = p.movedTechnicians.length;
  const trimmed = p.trimmedTechnicians.length;
  const tickets = p.restampedTickets.count;
  return { moved, trimmed, tickets, any: moved > 0 || trimmed > 0 || tickets > 0 };
}

/** Apply is blocked by a clash, or impossible while no plan has arrived. */
export function canApply(p: PincodeChange | undefined): boolean {
  return p !== undefined && p.clashCount === 0;
}

/**
 * "1 pincode" / "11 pincodes" — the two-form spell the copy table's sentences
 * need, on the same rule as `lib/plural.ts`. One is never pluralised with an
 * "s", and counts past 999 keep their thousands separator.
 */
export function formatCount(n: number, one: string, many: string): string {
  return n === 1 ? `${n} ${one}` : `${n.toLocaleString()} ${many}`;
}

/** True when the noun's count should read as one — grammar, not data. */
const isOne = (n: number) => Math.abs(n) === 1;

/**
 * The summary lines under the ranges box, in §5.10's copy.
 *
 * - "{n} pincodes" — the codes in these ranges the master holds.
 * - "{n} added" — only when something is actually being added.
 * - the "not in the pincode master" line — only when the ranges also cover
 *   codes the master does not hold (singular verb when it is one).
 * - "{n} handed back to {homeName}" — only when the edit shrinks.
 * - "No technicians or tickets are affected." — the reader's "so what?" when
 *   nothing moves. When something DOES, the impact tables say so below.
 */
export function previewSummary(p: PincodeChange, homeName: string): string[] {
  const lines = [formatCount(p.resolvedCount, "pincode", "pincodes")];
  if (p.added.count > 0) {
    lines.push(formatCount(p.added.count, "pincode", "pincodes") + " added");
  }
  if (p.unknownCount > 0) {
    lines.push(
      isOne(p.unknownCount)
        ? "1 in these ranges is not in the pincode master and is skipped."
        : `${p.unknownCount.toLocaleString()} in these ranges are not in the pincode master and are skipped.`
    );
  }
  if (p.removed.count > 0) {
    lines.push(
      `${formatCount(p.removed.count, "pincode", "pincodes")} handed back to ${homeName}`
    );
  }
  if (!previewImpact(p).any) {
    lines.push("No technicians or tickets are affected.");
  }
  return lines;
}