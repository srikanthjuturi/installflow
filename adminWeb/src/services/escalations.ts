/**
 * Escalation transport — live FastAPI, not the mock client.
 *
 * A ticket lands here when its confirmed slot came within
 * `ESCALATE_HOURS_BEFORE_SLOT` (4h) and nobody had accepted it (§7). The sweep
 * moves it to `Escalated`, which takes it OUT of the job pool: no technician
 * can take it while a manager owns it, and there are exactly two ways back —
 * fund a bonus and re-publish, or assign somebody outright.
 *
 * Both are territory-scoped and rank-gated on the server: Area Manager and
 * above, each seeing only the pincodes they cover. Nothing here has to know
 * that; it is simply what arrives.
 *
 * This module used to hold three hardcoded rows keyed by ticket CODE, which is
 * why the queue could never be reached from a real ticket — a UUID was never
 * one of them.
 */

import type { Ticket, TicketDetail } from "@/types/ticket";
import { apiGet, apiPost } from "./http";

/**
 * The whole queue, soonest slot first.
 *
 * Deliberately NOT paginated, and the API agrees — see its own note. The queue
 * renders as cards with no paging affordance and every row is a customer
 * holding a confirmed slot that is counting down, so a row on an invisible
 * page two is a missed appointment. If it ever outgrows a screenful, that is a
 * decision about the screen rather than a page parameter.
 */
export function listEscalations(): Promise<Ticket[]> {
  return apiGet<Ticket[]>("/tickets/escalations");
}

export interface AddBonusInput {
  id: string;
  /** PAISE. The picker's bands are rupees; the boundary converts. */
  amountPaise: number;
}

export interface RenotifyResult {
  ticket: TicketDetail;
  /**
   * How many technicians the push actually reached, counted with the same
   * predicate the push used — not an estimate.
   *
   * **Zero is a real and important answer.** It means no bonus can work here,
   * because nobody covers this pincode for this product with room on that day,
   * and the manager should go straight to assigning or to coverage.
   */
  notified: number;
}

/**
 * Fund an incentive and put the job back in the pool.
 *
 * The confirmed slot does not move — only who is being asked to take it, and
 * for how much. The amount REPLACES any previous bonus rather than adding to
 * it: the button reads "Add ₹400 bonus & re-notify", and a second press
 * meaning ₹800 would be a manager spending money they did not think they were.
 *
 * **409 `NOT_ESCALATED`** means the job is no longer sitting unaccepted, which
 * almost always means somebody took it while the manager was choosing a band.
 * That is the outcome everybody wanted, and the toaster says so.
 */
export function addBonusAndRenotify({
  id,
  amountPaise,
}: AddBonusInput): Promise<RenotifyResult> {
  return apiPost<RenotifyResult>(`/tickets/${id}/bonus`, { amountPaise });
}
