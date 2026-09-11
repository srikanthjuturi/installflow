/**
 * Redemptions transport — live FastAPI.
 *
 * A technician asks for their balance; the company's National Head (or an
 * Admin where it has none) pays it by UPI from their own phone, scanning a QR
 * the server built. There is no gateway, so nothing here can see the money:
 * the payer CLAIMS they paid, with a screenshot, and only the TECHNICIAN
 * confirms it arrived — from the app. **There is no function here that marks a
 * redemption paid, and there must never be one.** An admin confirming would be
 * inventing a fact nobody in the console can see.
 *
 * Every call is gated on `redemptions.pay` AND a National-Head rank floor the
 * server holds, the same shape as approvals: it spends company money.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  ClaimRedemptionInput,
  DeclineRedemptionInput,
  Redemption,
  RedemptionDetail,
} from "@/types/redemption";
import { apiGet, apiGetPage, apiPost } from "./http";

/**
 * One page of the queue. `filters.state` is `to_pay`, `awaiting`, `settled` or
 * `declined`; absent is everything. "To pay" comes back OLDEST first — it is a
 * queue — and everything else newest first. An unknown state is an empty page,
 * not a 422, because it rides in a shareable query string.
 */
export function listRedemptions(
  params: ListParams = {}
): Promise<Page<Redemption>> {
  return apiGetPage<Redemption>("/redemptions", params);
}

/** How many nobody has paid yet — the rail badge. */
export async function redemptionsToPayCount(): Promise<number> {
  const { toPay } = await apiGet<{ toPay: number }>("/redemptions/count");
  return toPay;
}

export function getRedemption(id: string): Promise<RedemptionDetail> {
  return apiGet<RedemptionDetail>(`/redemptions/${id}`);
}

/**
 * "I paid." The screenshot is required and goes up first through
 * `POST /uploads?kind=attachment` — a blob NAME travels here, never the bytes.
 * The UTR is optional. Repeatable until the technician confirms, so a payment
 * that failed after the screenshot can be claimed again with a new one.
 *
 * 409 `ALREADY_SETTLED` once it is confirmed or declined.
 */
export function claimRedemption({
  id,
  proof,
  utr,
}: ClaimRedemptionInput): Promise<RedemptionDetail> {
  return apiPost<RedemptionDetail>(`/redemptions/${id}/claim`, {
    proof,
    ...(utr ? { utr } : {}),
  });
}

/**
 * Refuse it before paying, with a reason the technician reads. Frees the amount
 * back to their balance. 409 `ALREADY_CLAIMED` once anybody has said they paid —
 * money may have moved by then.
 */
export function declineRedemption({
  id,
  reason,
}: DeclineRedemptionInput): Promise<RedemptionDetail> {
  return apiPost<RedemptionDetail>(`/redemptions/${id}/decline`, { reason });
}
