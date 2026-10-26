/**
 * The penalty pool — live FastAPI, not the mock client.
 *
 * §7 makes these two movements one fact: *"Cancellation penalties are
 * collected INTO a pool, and that same pool is what FUNDS the bonus paid to
 * whoever picks up an escalated ticket."* Money in equals money out, so the
 * balance is the arithmetic rather than a fourth stored number:
 * `balancePaise === penaltiesCollectedPaise - bonusesPaidPaise`.
 *
 * Both figures were invented until the cancel flow landed. A penalty exists
 * now because a technician gave a job up and was charged for it, and a bonus
 * because somebody finished one that had been escalated.
 *
 * **Paise on the wire**, like `ticket.bonusPaise` and unlike `settings/rules`,
 * which converts to rupees because a person types into that form. Nobody types
 * here. Render through `moneyPaise`.
 */

import type { ListParams, Page } from "@/types/api";
import type { LedgerEntry } from "@/types";
import { apiGet, apiGetBlob, apiGetPage } from "./http";

export interface LedgerPool {
  /**
   * Unspent penalty money — what a bonus is drawn against.
   *
   * **Can be negative.** That is a real state and is shown rather than
   * clamped: it means more has been committed in bonuses than cancellations
   * have funded, which is a decision somebody made and should be able to read
   * back.
   */
  balancePaise: number;
  /** Positive, and NET of reversals. The sign belongs on the entry, not here. */
  penaltiesCollectedPaise: number;
  /**
   * Entries, not tickets — a job cancelled twice collected twice. Only the
   * penalties still standing: a reversed one drops out of the count exactly as
   * its money drops out of the sum above.
   */
  cancellations: number;
  bonusesPaidPaise: number;
  pickups: number;
  /**
   * Task 11's breakdown (W11) — the speed kinds INSIDE the two tiles above,
   * never on top of them: `penaltiesCollectedPaise` already includes
   * `speedPenaltyPaise` and `bonusesPaidPaise` already includes
   * `speedRewardPaise`, so `collected − bonuses = balance` holds on every
   * console. Optional because a server older than Task 11 sends none of them.
   */
  speedPenaltyPaise?: number;
  speedPenalties?: number;
  speedRewardPaise?: number;
  speedRewards?: number;
  /** Whose pool this is (Task 05, F12) — every money read names its franchisee. */
  franchiseeId: string;
  franchiseeName: string;
}

/**
 * `?franchiseeId=` names whose pool is being read.
 *
 * Absent means the principal's own — home for staff, the franchisee's for a
 * portal session. A staff Admin or NH names another franchisee's to read its
 * pool; an unknown id is a 404 and a franchise principal is refused before the
 * query even runs, so nothing here validates the id: the server owns that.
 */
export interface LedgerPoolParams {
  franchiseeId?: string | null;
}

export function getLedgerPool(params: LedgerPoolParams = {}): Promise<LedgerPool> {
  const q = new URLSearchParams();
  if (params.franchiseeId) q.set("franchiseeId", params.franchiseeId);
  const qs = q.toString();
  return apiGet<LedgerPool>(`/ledger/pool${qs ? `?${qs}` : ""}`);
}

/**
 * One page of movements, newest first.
 *
 * Ordering is the server's and is not negotiable from here: a ledger is read
 * from the most recent transaction back, and letting the table re-sort a page
 * would sort twenty rows out of hundreds — which looks like a sort and is not
 * one. The `kind` filter goes through `filters`, which the transport flattens
 * into the query string.
 */
export function listLedgerEntries(
  params: ListParams = {}
): Promise<Page<LedgerEntry>> {
  return apiGetPage<LedgerEntry>("/ledger", params);
}

/**
 * The staff twin of the portal's employee statement (§5.10): one HOME
 * employee's month, a CSV. The endpoint is home-franchisee only and National
 * Head and above server-side (Task 06) — a gate the staff profile card
 * mirrors, so nobody reaches the click just to be refused.
 *
 * The blob only: the browser names the file, for the same
 * `Content-Disposition`-is-not-CORS-exposed reason the portal's
 * `components/franchise/statements.ts` documents.
 */
export function getLedgerStatement(
  technicianId: string,
  month: string
): Promise<Blob> {
  return apiGetBlob(
    `/ledger/statements/${technicianId}?month=${encodeURIComponent(month)}`
  );
}
