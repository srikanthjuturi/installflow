/**
 * Company <-> franchisee transfers (Epic 1.2) — the wire shapes and the pure
 * rules both surfaces share. Mirrors `api/app/features/franchise_settlements`.
 * Amounts are PAISE integers, like every money value the API sends.
 */

/** Which door a screen talks to: the company's console or the franchise portal. */
export type SettlementSide = "staff" | "portal";

export type SettlementDirection = "company_to_franchisee" | "franchisee_to_company";
export type SettlementReason =
  | "lease"
  | "revenue_share"
  | "advance"
  | "adjustment"
  | "other";
export type SettlementState = "awaiting" | "settled" | "declined";

export const SETTLEMENT_REASONS: readonly SettlementReason[] = [
  "lease",
  "revenue_share",
  "advance",
  "adjustment",
  "other",
];
export const SETTLEMENT_REASON_LABELS: Record<SettlementReason, string> = {
  lease: "Lease",
  revenue_share: "Revenue share",
  advance: "Advance",
  adjustment: "Adjustment",
  other: "Other",
};

export const SETTLEMENT_STATES: readonly SettlementState[] = [
  "awaiting",
  "settled",
  "declined",
];
export const SETTLEMENT_STATE_LABELS: Record<SettlementState, string> = {
  awaiting: "Awaiting",
  settled: "Settled",
  declined: "Declined",
};

export interface Settlement {
  id: string;
  code: string;
  franchiseeId: string;
  franchiseeName: string;
  direction: SettlementDirection;
  amountPaise: number;
  reason: SettlementReason;
  note: string | null;
  transferredOn: string;
  utr: string | null;
  proofUrl: string | null;
  state: SettlementState;
  waitingOn: "company" | "franchisee" | null;
  recordedByLabel: string | null;
  createdAt: string;
  confirmedAt: string | null;
  confirmedByLabel: string | null;
  declinedAt: string | null;
  declinedByLabel: string | null;
  declineReason: string | null;
  documentNumber: string | null;
}

export interface SettlementSummary {
  franchiseeId: string | null;
  companyToFranchiseePaise: number;
  franchiseeToCompanyPaise: number;
  netPaise: number;
  awaitingCount: number;
}

export interface SettlementCount {
  awaitingMe: number;
}

export interface SettlementFranchisee {
  id: string;
  name: string;
}

export interface RecordSettlementInput {
  /** Staff only — the portal never sends it; the server uses the caller's own. */
  franchiseeId?: string;
  amountPaise: number;
  reason: SettlementReason;
  note?: string;
  transferredOn: string;
  utr?: string;
  proof: { blobName: string; fileName?: string };
}

/** Which side a viewer is, in the vocabulary of `waitingOn`. */
export function viewerParty(side: SettlementSide): "company" | "franchisee" {
  return side === "staff" ? "company" : "franchisee";
}

/**
 * Whether THIS viewer may confirm or decline a row. Only the receiving side
 * can, and only while it is still waiting — the sender never confirms their own
 * transfer, and a decided row is final. The server refuses the rest
 * (`NOT_THE_RECEIVER`, `ALREADY_DECLINED`, `ALREADY_CONFIRMED`); this only
 * keeps the buttons off rows they could never work.
 */
export function canDecide(row: Settlement, side: SettlementSide): boolean {
  return row.state === "awaiting" && row.waitingOn === viewerParty(side);
}

/** The row's direction in the viewer's own words. */
export function directionLabel(
  direction: SettlementDirection,
  side: SettlementSide
): string {
  const outgoing = (direction === "company_to_franchisee") === (side === "staff");
  if (side === "staff") {
    return outgoing ? "Paid to franchisee" : "Received from franchisee";
  }
  return outgoing ? "Sent to company" : "Received from company";
}

/** Rupees typed in a form -> whole paise. Rounds so `3200.5` cannot drift. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Paise -> the bare rupee figure a form field holds. */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}
