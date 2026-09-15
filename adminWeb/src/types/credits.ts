/**
 * A company's credits and its recharges — see `api/app/models/credits.py`.
 *
 * One credit is one rupee's worth, spent when a ticket is RAISED. The balance
 * may go below zero down to a floor, after which new tickets are refused until
 * the company recharges: it pays the platform's UPI QR, CLAIMS it paid (UTR and
 * screenshot), and only the superadmin CONFIRMS it — which is the one thing
 * that adds credits.
 */

/** Derived by the server from the timestamps; there is no status column. */
export const RECHARGE_STATES = [
  "to_pay",
  "waiting",
  "credited",
  "rejected",
  "cancelled",
] as const;
export type RechargeState = (typeof RECHARGE_STATES)[number];

export const RECHARGE_STATE_LABELS: Record<RechargeState, string> = {
  to_pay: "To pay",
  waiting: "Waiting",
  credited: "Credited",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const CREDIT_ENTRY_KINDS = ["free", "ticket", "recharge"] as const;
export type CreditEntryKind = (typeof CREDIT_ENTRY_KINDS)[number];

export const CREDIT_ENTRY_KIND_LABELS: Record<CreditEntryKind, string> = {
  free: "Free credits",
  ticket: "Ticket",
  recharge: "Recharge",
};

export interface Recharge {
  id: string;
  code: string;
  state: RechargeState;
  amountPaise: number;
  credits: number;
  /** The platform's UPI ID and name when this was asked for, frozen. */
  upiId: string;
  payeeName: string;
  requestedAt: string;
  requestedBy: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  utr: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
}

export interface RechargeDetail extends Recharge {
  /** The server's finished `upi://pay?…` — only while nothing is claimed. */
  upiUri: string | null;
  /** The screenshot, as a link that dies in fifteen minutes. */
  proofUrl: string | null;
}

export interface CreditSummary {
  /** Negative once the company is using minus credits. */
  balance: number;
  ticketCredits: number;
  minusCreditLimit: number;
  /** The next ticket would be refused. */
  paused: boolean;
  minRechargeRupees: number;
  maxRechargeRupees: number;
  /** False until the platform has a UPI ID to be paid to. */
  rechargeAvailable: boolean;
  openRecharge: Recharge | null;
}

export interface CreditEntry {
  id: string;
  kind: CreditEntryKind;
  /** Signed: a ticket reads −10, a recharge +500. */
  credits: number;
  at: string;
  ticketId: string | null;
  ticketCode: string | null;
  rechargeId: string | null;
  rechargeCode: string | null;
}

export interface ClaimRechargeInput {
  id: string;
  utr: string;
  proof: { blobName: string; fileName?: string };
}
