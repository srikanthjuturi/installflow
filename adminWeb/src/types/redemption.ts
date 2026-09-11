/**
 * A technician cashing out their balance, as the payer sees it.
 *
 * Mirrors `StaffRedemptionOut` / `StaffRedemptionDetailOut` in
 * `api/app/features/redemptions/schemas.py`. There is no status column behind
 * `state` — the server derives it from timestamps, because "paid" is the
 * technician's confirmation and nothing else (see `models/redemption.py`).
 */

export const REDEMPTION_STATES = [
  "to_pay",
  "awaiting",
  "settled",
  "declined",
] as const;

export type RedemptionState = (typeof REDEMPTION_STATES)[number];

/** Approved with the plan on 2026-09-11 — the prototype has no such screen. */
export const REDEMPTION_STATE_LABELS: Record<RedemptionState, string> = {
  to_pay: "To pay",
  awaiting: "Awaiting technician",
  settled: "Settled",
  declined: "Declined",
};

export interface Redemption {
  id: string;
  /** `MA-RDM-0001` — also the reference on both bank statements. */
  code: string;
  state: RedemptionState;
  amountPaise: number;
  /** Frozen when requested — where THIS one is paid. */
  upiId: string;
  payeeName: string;
  requestedAt: string;
  claimedAt: string | null;
  claimedBy: string | null;
  utr: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declinedBy: string | null;
  declineReason: string | null;
  /** When the technician last said "not yet" to the CURRENT claim. */
  deniedAt: string | null;
  technicianId: string;
  technicianName: string;
  technicianCode: string;
}

export type RedemptionEventKind =
  | "requested"
  | "claimed"
  | "denied"
  | "confirmed"
  | "declined";

export interface RedemptionEvent {
  id: string;
  kind: RedemptionEventKind;
  at: string;
  actorKind: "staff" | "technician";
  actorLabel: string | null;
  utr: string | null;
  note: string | null;
}

export interface RedemptionDetail extends Redemption {
  /**
   * The finished `upi://pay?…` string. Draw it; never parse or rebuild it.
   * Null once settled or declined — there is nothing left to pay.
   */
  upiUri: string | null;
  /** The latest claim's screenshot, as a link that dies in fifteen minutes. */
  proofUrl: string | null;
  events: RedemptionEvent[];
  technicianPhone: string | null;
}

export interface ClaimRedemptionInput {
  id: string;
  proof: { blobName: string; fileName?: string };
  utr?: string;
}

export interface DeclineRedemptionInput {
  id: string;
  reason: string;
}
