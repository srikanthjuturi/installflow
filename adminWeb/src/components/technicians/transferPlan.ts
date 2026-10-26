/**
 * Moving a technician between franchisees — the logic the dialog renders
 * (Task 17 §5.5).
 *
 * Pure and DOM-free, so `transferPlan.test.ts` exercises every rule with
 * nothing else on screen (X1). The server is the only authority on what a move
 * does: this file decides what the console OFFERS (is Move enabled, which
 * franchisees are listed, how a row of history reads) and never re-derives a
 * figure the preview already carries.
 */

import { PINCODE_OUTSIDE_FRANCHISEE } from "@/lib/errorCodes";
import type { FranchiseeOption } from "@/types/franchisee";
import type {
  TechnicianTransfer,
  TechnicianTransferResult,
  TransferBlocker,
} from "@/types/technician";

/** Mirrors the server's `MIN_REASON` / `MAX_REASON` (the column is 255). */
export const MIN_REASON = 5;
export const MAX_REASON = 255;

/**
 * Why this reason will not do, or null. Trims first — "    " is nothing — and
 * says it in the server's own words so the field and a refusal never differ.
 */
export function reasonProblem(text: string, name?: string): string | null {
  const stripped = text.trim();
  if (stripped.length < MIN_REASON) {
    return `Say why ${name ?? "this technician"} is being moved (at least ${MIN_REASON} characters)`;
  }
  if (stripped.length > MAX_REASON) {
    return `Keep the reason under ${MAX_REASON} characters`;
  }
  return null;
}

/**
 * The one line under the coverage heading: "All 3 stay", "2 stay · 1 taken off",
 * "0 stay · 2 added". "All n stay" only when nothing at all changes.
 */
export function coverageSummary(p: {
  keptCount: number;
  trimmedCount: number;
  addedCount: number;
}): string {
  if (p.trimmedCount === 0 && p.addedCount === 0 && p.keptCount > 0) {
    return `All ${p.keptCount} stay`;
  }
  const parts = [`${p.keptCount} stay`];
  if (p.trimmedCount > 0) parts.push(`${p.trimmedCount} taken off`);
  if (p.addedCount > 0) parts.push(`${p.addedCount} added`);
  return parts.join(" · ");
}

/** The sentences, in the server's order (jobs before balance) and as sent. */
export function blockerLines(blockers: TransferBlocker[]): string[] {
  return blockers.map((b) => b.message);
}

/**
 * Is there anything "nothing inside the range" about this preview?
 *
 * The server answers it with `PINCODE_OUTSIDE_FRANCHISEE` on a preview that
 * KEPT coverage (no pincodes were sent) and left none. That is the normal case,
 * not an edge: franchisee areas are disjoint and a technician's coverage lies in
 * their own franchisee's area, so a plain move keeps nothing — and the dialog's
 * answer is to open the picker, not to dead-end.
 */
export function nothingInsideRange(preview: TechnicianTransferResult | undefined): boolean {
  return (
    !!preview &&
    preview.coverage.source === "kept" &&
    preview.coverage.after.length === 0 &&
    preview.blockers.some((b) => b.code === PINCODE_OUTSIDE_FRANCHISEE)
  );
}

/** The blocker, if any, that says the target has nobody to run it. */
export function hasNoAdmin(blockers: TransferBlocker[]): boolean {
  return blockers.some((b) => b.code === "FRANCHISEE_HAS_NO_ADMIN");
}

/**
 * May **Move** be pressed? A clean preview AND a reason that passes AND nothing
 * in flight. `busy` is the caller's "a preview is still being asked for, or the
 * move is being made" — an answer that is about to be replaced must not be
 * confirmed.
 */
export function canConfirm(
  preview: TechnicianTransferResult | undefined,
  reason: string,
  busy: boolean
): boolean {
  if (!preview || busy) return false;
  if (preview.blockers.length > 0 || !preview.canTransfer) return false;
  return reasonProblem(reason) === null;
}

export interface TargetOption {
  value: string;
  label: string;
  disabled: boolean;
}

/**
 * Who can be moved TO: everyone but where the technician already is, home
 * first, then the rest in the order given. An inactive franchisee is listed —
 * a person looking for it should find it and be told why not — but disabled,
 * and its label says so.
 */
export function targetOptions(
  opts: FranchiseeOption[],
  currentId: string
): TargetOption[] {
  const suffix = (o: FranchiseeOption) =>
    !o.isActive ? " (inactive)" : o.isHome ? " (home)" : "";
  return (
    opts
      .filter((o) => o.id !== currentId)
      .map((o) => ({
        home: o.isHome,
        value: o.id,
        label: `${o.name}${suffix(o)}`,
        disabled: !o.isActive,
      }))
      // `sort` is stable: the non-home franchisees keep the server's order.
      .sort((a, b) => Number(b.home) - Number(a.home))
      .map(({ value, label, disabled }) => ({ value, label, disabled }))
  );
}

/* ── history ───────────────────────────────────────────────────────────────── */

/** "16-10-2026" — the day in India, however the browser's zone is set. */
export function historyDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

const pincodes = (n: number) => `${n.toLocaleString()} ${n === 1 ? "pincode" : "pincodes"}`;

/**
 * One line of the Transfer history card: the head
 * (`16-10-2026 · Acme Appliances → SkyFix Services · by Nisha Rao`) and the
 * detail under it (the reason, then what happened to the pincodes).
 */
export function historyLine(row: TechnicianTransfer): { head: string; detail: string } {
  const head = `${historyDate(row.at)} · ${row.fromFranchiseeName} → ${row.toFranchiseeName} · by ${row.byName}`;

  const coverage: string[] = [];
  if (row.trimmed.length === 0 && row.added.length === 0) {
    coverage.push(`All ${pincodes(row.kept.length)} stayed`);
  } else {
    coverage.push(`${pincodes(row.kept.length)} stayed`);
    if (row.trimmed.length > 0) {
      coverage.push(`${row.trimmed.length.toLocaleString()} taken off (${row.trimmed.join(", ")})`);
    }
    if (row.added.length > 0) {
      coverage.push(`${row.added.length.toLocaleString()} added (${row.added.join(", ")})`);
    }
  }
  return { head, detail: [`“${row.reason}”`, ...coverage].join(" · ") };
}

/* ── the target's area, for the picker ─────────────────────────────────────── */

/**
 * A membership test for a franchisee's stored ranges (`"500030-500040, 500120"`,
 * the server's own `compress()` output), or null when there is nothing to limit
 * by — the home owns "everything nobody else does", which no range spells out.
 *
 * It only NARROWS what the picker offers. The preview still names any code the
 * server says is outside, so a mistake here shows up as a sentence, never as a
 * wrong move.
 */
export function rangeMatcher(ranges: string): ((code: string) => boolean) | null {
  const entries = ranges
    .split(/[,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  const spans: Array<[number, number]> = [];
  for (const entry of entries) {
    const m = /^(\d{6})\s*[-–]\s*(\d{6})$/.exec(entry) ?? /^(\d{6})$/.exec(entry);
    if (!m) return null; // something unfamiliar: do not guess, offer everything
    spans.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return (code) => {
    const n = Number(code);
    return spans.some(([lo, hi]) => n >= lo && n <= hi);
  };
}
