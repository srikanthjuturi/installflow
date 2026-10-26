/**
 * The words on the ticket's Travel and Speed panels — PURE, so §5.10's
 * PROPOSED copy is tested rather than eyeballed, and `AllowancePanels` only
 * lays it out.
 */

import type { TicketSpeed, TicketTravel } from "@/types/allowances";
import type { TicketStatus } from "@/types/ticket";
import { isTerminalTicketStatus } from "@/types/ticket";
import { EMPTY, formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/* ── time ─────────────────────────────────────────────────────────────── */

/** `9.4` → `9 h 24 m`. Minutes are rounded; a negative or non-finite value reads `0 h 0 m`. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) {
    return EMPTY;
  }
  const total = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(total / 60)} h ${total % 60} m`;
}

/* ── travel ───────────────────────────────────────────────────────────── */

export const TRAVEL_REASON: Record<
  NonNullable<TicketTravel["reason"]>,
  string
> = {
  no_base_location: "No base location when accepted — nothing to pay.",
  no_customer_point: "No location for the customer — measured as 0 km.",
};

const BASE_TEXT: Record<string, string> = {
  pincode: "Base · pincode centre",
  map: "Base · map pin",
  gps: "Base · phone location",
  manual: "Base · typed coordinates",
};

const CUSTOMER_TEXT: Record<string, string> = {
  ticket: "Customer's address pin",
  pincode: "Customer's pincode centre",
};

const own = (table: Record<string, string>, key: string | null) =>
  key !== null && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : null;

/** `From` row — null when there was no base (the reason line says why). */
export const travelFrom = (t: Pick<TicketTravel, "baseSource">) =>
  own(BASE_TEXT, t.baseSource) ?? (t.baseSource ? `Base · ${t.baseSource}` : null);

/** `To` row — null when there was no customer point. */
export const travelTo = (t: Pick<TicketTravel, "customerSource">) =>
  own(CUSTOMER_TEXT, t.customerSource) ??
  (t.customerSource ? String(t.customerSource) : null);

/** `Distance` row: `28.1 km by road (21.6 km straight × 130 %)`. */
export const travelDistance = (
  t: Pick<TicketTravel, "km" | "straightKm" | "roadFactorPct">
) => `${t.km} km by road (${t.straightKm} km straight × ${t.roadFactorPct} %)`;

/** `Rule` row: `20 km free, then ₹10 per 2 km, up to ₹300`. */
export const travelRule = (
  t: Pick<
    TicketTravel,
    "freeKm" | "stepKm" | "paisePerStep" | "maxPaisePerJob"
  >
) =>
  `${t.freeKm} km free, then ${moneyPaise(t.paisePerStep)} per ${t.stepKm} km, up to ${moneyPaise(t.maxPaisePerJob)}`;

/**
 * `Allowance` row: what was paid, or what will be, or that nothing is.
 *
 * `creditedPaise` is the ledger row (never 0). With none: a settled ticket was
 * not paid, an open one with an amount is paid when the customer confirms, and
 * an open one with ₹0 has nothing to wait for.
 */
export function travelStatus(
  t: Pick<TicketTravel, "creditedPaise" | "amountPaise">,
  ticketStatus: TicketStatus
): string {
  if (t.creditedPaise !== null) return `Paid ${moneyPaise(t.creditedPaise)}`;
  if (isTerminalTicketStatus(ticketStatus)) return "Not paid";
  return t.amountPaise > 0 ? "Paid when the customer confirms" : "Not paid";
}

/* ── speed ────────────────────────────────────────────────────────────── */

/** `Product: X` or `Category: X`. */
export const speedRule = (s: Pick<TicketSpeed, "matchedOn" | "matchedName">) =>
  `${s.matchedOn === "model" ? "Product" : "Category"}: ${s.matchedName}`;

/**
 * Which half of the later-of-two the clock took (R1): the slot's start, or the
 * accept. Compared as instants so the same moment written two ways still
 * matches; a missing slot is the accept by definition.
 */
export function clockOrigin(
  s: Pick<TicketSpeed, "clockStartedAt" | "slotStart">
): "(start of the slot)" | "(when it was accepted)" {
  if (
    s.clockStartedAt &&
    s.slotStart &&
    new Date(s.clockStartedAt).getTime() === new Date(s.slotStart).getTime()
  ) {
    return "(start of the slot)";
  }
  return "(when it was accepted)";
}

/**
 * `Time taken`: `9 h 24 m` (+ `, excluding 2 h 6 m waiting for parts`) once
 * measured; `Clock started 12 Oct, 10:00 AM (start of the slot)` while it runs.
 */
export function speedTimeTaken(
  s: Pick<
    TicketSpeed,
    "workingHours" | "partWaitHours" | "clockStartedAt" | "slotStart"
  >
): string {
  if (s.workingHours !== null) {
    const waited =
      s.partWaitHours !== null && s.partWaitHours > 0
        ? `, excluding ${formatHours(s.partWaitHours)} waiting for parts`
        : "";
    return `${formatHours(s.workingHours)}${waited}`;
  }
  if (s.clockStartedAt) {
    return `Clock started ${formatDateTime(s.clockStartedAt)} ${clockOrigin(s)}`;
  }
  return EMPTY;
}

/** `Outcome` row — the headline, then the two qualifiers (as separate strings). */
export function speedOutcome(
  s: Pick<
    TicketSpeed,
    "outcome" | "paidPaise" | "rewardPaise" | "capped" | "reversed"
  >
): { text: string; notes: string[] } {
  const notes: string[] = [];
  let text: string;
  switch (s.outcome) {
    case "reward":
      text = `Rewarded ${moneyPaise(s.paidPaise ?? s.rewardPaise)}`;
      break;
    case "penalty":
      // A penalty the cap cut to nothing has no ledger row: the amount charged
      // is ₹0, and `capped` says why.
      text = `Penalised ${moneyPaise(-(s.paidPaise ?? 0))}`;
      break;
    case "none":
      text = "Neither — between the two";
      break;
    case "force_closed":
      text = "Not paid — force-closed";
      break;
    case "pending":
    default:
      text = "Settled when the customer confirms";
  }
  if (s.capped) notes.push("capped by the monthly limit");
  if (s.reversed) notes.push("reversed");
  return { text, notes };
}
