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
import { apiGet, apiGetPage } from "./http";

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
  /** Positive. The debit sign belongs on the entry, not on the total. */
  penaltiesCollectedPaise: number;
  /** Entries, not tickets — a job cancelled twice collected twice. */
  cancellations: number;
  bonusesPaidPaise: number;
  pickups: number;
}

export function getLedgerPool(): Promise<LedgerPool> {
  return apiGet<LedgerPool>("/ledger/pool");
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
