import { ApiError, authedRequest } from '@/lib/api';

/**
 * Cashing out the balance — paid by UPI, straight to the technician's account.
 *
 *   getRedeemable      → GET  /redemptions/me
 *   requestRedemption  → POST /redemptions/me
 *   listRedemptions    → GET  /redemptions/me/history
 *   getRedemption      → GET  /redemptions/me/:id
 *   confirmRedemption  → POST /redemptions/me/:id/confirm
 *
 * ## Nothing here can see the money
 *
 * There is no payment gateway. The payer — the company's National Head, or an
 * Admin where it has none — scans a QR and pays from their own phone, and the
 * two banks never talk to us. So a redemption is two people's word: the payer
 * CLAIMS they paid (with a screenshot), and the technician CONFIRMS it arrived.
 * `confirmRedemption(id, true)` is the only thing in the whole product that
 * makes a redemption paid — which is why the button that calls it must never
 * be pressed on the technician's behalf by anything but the technician.
 *
 * ## The amount is the server's
 *
 * `requestRedemption` sends the figure the screen SHOWED, not a sum it wants.
 * The server cuts the amount from the ledger itself; the figure is there so a
 * balance that moved in between comes back as `BALANCE_CHANGED` rather than
 * as a request for money the technician never saw on screen.
 *
 * Copy for everything this feeds is net-new — the prototype has no redeem
 * screen — and was approved with the plan on 2026-09-11.
 */

/** Derived by the server from its timestamps; see `RedemptionState` in the API. */
export type RedemptionState = 'to_pay' | 'awaiting' | 'settled' | 'declined';

export interface Redemption {
  id: string;
  /** `MA-RDM-0001` — also the reference on both bank statements. */
  code: string;
  state: RedemptionState;
  amountPaise: number;
  /** Frozen when requested: where THIS one is paid, whatever the profile says now. */
  upiId: string;
  payeeName: string;
  requestedAt: string;
  claimedAt: string | null;
  /** The payer's name when they said they paid. */
  claimedBy: string | null;
  utr: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declinedBy: string | null;
  declineReason: string | null;
  /** When the technician last said "not yet" to the CURRENT claim. */
  deniedAt: string | null;
}

export type RedemptionEventKind = 'requested' | 'claimed' | 'denied' | 'confirmed' | 'declined';

export interface RedemptionEvent {
  id: string;
  kind: RedemptionEventKind;
  at: string;
  actorKind: 'staff' | 'technician';
  actorLabel: string | null;
  utr: string | null;
  note: string | null;
}

export interface RedemptionDetail extends Redemption {
  /**
   * The finished `upi://pay?…` string — draw it, never parse or rebuild it.
   * Null once somebody has claimed: a QR still on this screen after that would
   * be an invitation to pay twice.
   */
  upiUri: string | null;
  /** The payer's screenshot, as a link that dies in fifteen minutes. */
  proofUrl: string | null;
  events: RedemptionEvent[];
}

export interface Redeemable {
  /** Everything owed less everything asked for. May be negative. */
  availablePaise: number;
  /** What a request made now would be for. Zero means "nothing to redeem". */
  redeemablePaise: number;
  upiId: string | null;
  /** "National Head" or "Admin" — who will be asked to pay it. */
  payerLabel: string;
  /** The one open redemption, if any; while it is open no other can be made. */
  open: Redemption | null;
}

export function getRedeemable(): Promise<Redeemable> {
  return authedRequest<Redeemable>('/redemptions/me');
}

/**
 * The history, newest first. One page of 100 and no paging: a technician
 * redeems a few times a month at most, so a hundred is years of them, and a
 * list that pages would be machinery for a case that does not arrive.
 */
export function listRedemptions(): Promise<Redemption[]> {
  return authedRequest<Redemption[]>('/redemptions/me/history?limit=100');
}

export function getRedemption(id: string): Promise<RedemptionDetail> {
  return authedRequest<RedemptionDetail>(`/redemptions/me/${id}`);
}

/** Why a request was refused — each leads somewhere different on screen. */
export type RedeemRefusal =
  | 'BALANCE_CHANGED'
  | 'NO_UPI_ID'
  | 'NOTHING_TO_REDEEM'
  | 'REDEMPTION_OPEN';

const REFUSALS: readonly RedeemRefusal[] = [
  'BALANCE_CHANGED',
  'NO_UPI_ID',
  'NOTHING_TO_REDEEM',
  'REDEMPTION_OPEN',
];

/**
 * A "no" with a reason, switched on the envelope's `code` rather than the
 * 409 — four reasons share that status, and they send the technician to four
 * different places (a new figure, the payout account, nowhere, the open one).
 */
export class RedeemRefusedError extends Error {
  constructor(
    readonly code: RedeemRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'RedeemRefusedError';
  }
}

export function isRedeemRefused(error: unknown): error is RedeemRefusedError {
  return error instanceof RedeemRefusedError;
}

export async function requestRedemption(amountPaise: number): Promise<RedemptionDetail> {
  try {
    return await authedRequest<RedemptionDetail>('/redemptions/me', {
      method: 'POST',
      body: { amountPaise },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const refusal = REFUSALS.find((c) => c === error.code);
      if (refusal) throw new RedeemRefusedError(refusal, error.message);
    }
    throw error;
  }
}

/**
 * The technician's word. `true`: it arrived — the only way a redemption is ever
 * paid. `false`: not yet — the payer is told, and nothing else changes.
 * Idempotent on the server both ways, so a double tap is harmless.
 */
export function confirmRedemption(id: string, received: boolean): Promise<RedemptionDetail> {
  return authedRequest<RedemptionDetail>(`/redemptions/me/${id}/confirm`, {
    method: 'POST',
    body: { received },
  });
}
