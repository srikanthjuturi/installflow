/**
 * Where tapping a push goes — the pure half of `usePushRegistration`'s `open()`.
 *
 * Pushes carry routing data only (the frame holds no customer details; the
 * screen it opens fetches through the authenticated API):
 *
 *   redemption  → /redeem/{redemptionId}   a payer claimed or declined
 *   upi_change  → /payout-account          a manager decided a UPI change
 *   pool        → /pool/{ticketId}         an OFFER — masked, not yet theirs
 *   job         → /job/{ticketId}          one they hold: an assignment, a slot
 *                                          reminder, and every spare-part push
 *                                          (`part.approved` / `.rejected` /
 *                                          `.rejected_after_approval` /
 *                                          `.issued` — Task 12 D15)
 *
 * `pool` and `job` must not be merged: an assigned job is not in the pool, so
 * `/pool/:id` would 404 on a job the technician is due to attend. A redemption
 * names no ticket, so it is routed before the ticket test would drop it; its
 * screen fetches the rest (the payer's screenshot never travels in a push).
 *
 * Anything else, or a type missing the id it needs, is null: do nothing rather
 * than open a screen that would 404.
 */
export function pushRoute(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null;
  const { type, ticketId, redemptionId } = data as Record<string, unknown>;

  if (type === 'redemption') {
    return typeof redemptionId === 'string' ? `/redeem/${redemptionId}` : null;
  }
  if (type === 'upi_change') return '/payout-account';
  if (typeof ticketId !== 'string') return null;
  if (type === 'pool') return `/pool/${ticketId}`;
  if (type === 'job') return `/job/${ticketId}`;
  return null;
}
