/**
 * Handing an unassigned ticket to another franchisee (Task 18) — the pure half.
 *
 * Everything the dialog, the ticket page and the assign page decide from data
 * lives here so vitest can pin it with no DOM (`handOver.test.ts`). The server
 * decides every one of these again; nothing here is authorization.
 *
 * ⚠ **PROPOSED copy (X2) — every string below awaits the owner's sign-off**
 * (index §7: "18 Hand-to-franchisee dialog"). They are the doc's §5.3 table
 * as written; none comes from the prototype, which has no franchisees.
 */

import {
  HANDOVER_TICKET_STATUSES,
  type FranchiseeOption,
  type HandOverBlocker,
  type HandToFranchiseeResult,
  type TicketStatus,
} from "@/types/ticket";

/** The 409 codes a hand-over answers with that mean "this ticket moved while
 *  the dialog was open" — the dialog refetches and shows the blocker. Kept here,
 *  not in `errorCodes.ts`, because only this feature reads them. */
export const HAND_OVER_STALE_CODES: readonly string[] = [
  "TICKET_ASSIGNED",
  "TICKET_NOT_ASSIGNABLE",
  "ALREADY_ASSIGNED",
];

/** Mirrors `HANDOVER_STATUSES` + "nobody holds it" on the server. */
export function isHandable(ticket: {
  status: TicketStatus;
  technicianId: string | null;
}): boolean {
  return (
    ticket.technicianId === null &&
    HANDOVER_TICKET_STATUSES.includes(ticket.status)
  );
}

/**
 * Whether to draw **Hand to another franchisee**. `jobs.assign` is the same key
 * `POST /tickets/:id/assign` carries (H2); the Area-Manager rank floor is the
 * server's and the whole `isOps` action row is already hidden from franchise
 * principals and vendors.
 */
export function canHandOver(
  ticket: { status: TicketStatus; technicianId: string | null },
  has: (key: string) => boolean
): boolean {
  return has("jobs.assign") && isHandable(ticket);
}

/** `3 eligible · 2 online` / `0 eligible`. */
export function optionLabel(
  option: Pick<FranchiseeOption, "eligibleTechnicians" | "onlineTechnicians">
): string {
  if (option.eligibleTechnicians === 0) return "0 eligible";
  return `${option.eligibleTechnicians} eligible · ${option.onlineTechnicians} online`;
}

export const CLOSED_WINDOW_NOTE =
  "This job's time has passed, so no technician can be offered it. Handing it over still moves it; change the time with the customer to put it in the pool.";

/**
 * The note under a chosen franchisee, or null. A franchisee with nobody
 * eligible gets the warning (still confirmable — an Area Manager can assign by
 * hand); eligible-but-offline the softer note; and an `Escalated` ticket whose
 * window has closed adds the time-passed note on top.
 */
export function optionWarning(
  option: FranchiseeOption,
  ctx: { status: TicketStatus; slotOffered: boolean }
): string | null {
  const parts: string[] = [];
  if (option.eligibleTechnicians === 0) {
    parts.push(
      `Nobody at ${option.name} can take this job right now. You can still hand it over, and then assign someone by hand.`
    );
  } else if (option.onlineTechnicians === 0) {
    parts.push(
      `${option.eligibleTechnicians} eligible, but none are online. They'll see it when they go online.`
    );
  }
  if (ctx.status === "Escalated" && !ctx.slotOffered) {
    parts.push(CLOSED_WINDOW_NOTE);
  }
  return parts.length ? parts.join(" ") : null;
}

export const REASON_MIN = 3;
export const REASON_MAX = 255;

/** The reason field's error, or null. Trimmed before counting, like the API. */
export function reasonError(text: string): string | null {
  const n = text.trim().length;
  if (n < REASON_MIN) return "Say why you're handing it over.";
  if (n > REASON_MAX) return "Keep it under 255 characters.";
  return null;
}

export type PickerRow = FranchiseeOption & { disabled: boolean };

/**
 * The dialog's starting state: NOTHING selected — a hand-over is a decision, so
 * the button stays disabled until a franchisee and a reason are chosen even when
 * one option has people — and the current franchisee disabled.
 */
export function dialogDefault(options: FranchiseeOption[]): {
  franchiseeId: string;
  reason: string;
  rows: PickerRow[];
} {
  return {
    franchiseeId: "",
    reason: "",
    rows: options.map((o) => ({ ...o, disabled: o.isCurrent })),
  };
}

/** The sentence when the options call (or a refused submit) says it cannot move. */
export function blockerSentence(
  blocker: HandOverBlocker | null,
  ticket: { code: string; status: TicketStatus }
): string | null {
  const { code } = ticket;
  if (blocker === "TICKET_ASSIGNED") {
    return `${code} already has a technician. Cancel it from them first, or re-assign it.`;
  }
  if (blocker === "TICKET_NOT_ASSIGNABLE") {
    // The server's own sentence (api §4.6), not copy of ours.
    return `This ticket is ${ticket.status} and can no longer be moved.`;
  }
  return null;
}

/** The success toast's body. */
export function handOverToast(
  code: string,
  franchiseeName: string,
  result: Pick<HandToFranchiseeResult, "notified"> & {
    backInPool: boolean;
    wasEscalated: boolean;
  }
): string {
  if (result.wasEscalated && !result.backInPool) {
    return `${code} handed to ${franchiseeName}. It isn't in the pool — its time has passed.`;
  }
  const n = result.notified;
  return `${code} handed to ${franchiseeName}. ${n} technician${n === 1 ? "" : "s"} notified.`;
}

/** The assignment page's line under the title for a handed-over ticket. */
export function handedByLabel(franchiseeName: string | null): string {
  return `Handed over to ${franchiseeName ?? "another franchisee"}. Pincode coverage isn't required for this job.`;
}
