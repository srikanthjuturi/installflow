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

import type { Page, ListParams } from "@/types/api";
import type { Ticket, TicketDetail } from "@/types/ticket";
import { apiGetPage, apiPost } from "./http";

/**
 * One page of the queue, soonest slot first.
 *
 * Paged, but the screen has no pager: it loads the next page on scroll, so
 * every row stays reachable. That distinction is the whole reason this stayed
 * unpaginated for so long — each row is a customer holding a confirmed slot
 * that is counting down, and a row behind a page number is a missed
 * appointment.
 *
 * The API orders live rows before missed ones, so page one is the half that
 * can still be rescued. Scrolling only ever reaches further into the past.
 *
 * `search` matches code, customer, phone, pincode or serial — the same
 * predicate the ticket board uses. `filters` carries `half` (`live` | `missed`)
 * and the `slotFrom` / `slotTo` IST dates, flattened into the query string by
 * the transport. All of it is applied by the SERVER: narrowing the pages that
 * happen to be loaded would make "no match" mean "not in what you have
 * scrolled to", which on an infinite list is a lie with a plausible shape.
 */
export function listEscalations(
  params: ListParams = {}
): Promise<Page<Ticket>> {
  return apiGetPage<Ticket>("/tickets/escalations", params);
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
