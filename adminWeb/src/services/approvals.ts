/**
 * Product approvals transport — live FastAPI.
 *
 * A vendor may add products to their own book but not price them: what a
 * technician earns is withheld from a vendor everywhere in this product, and
 * what a vendor is *charged* is a term between them and the company rather than
 * something they set for themselves. So a submission arrives here unpriced and
 * unticketable, and a National Head or an Admin types both figures — or refuses
 * it with a reason the vendor reads and can act on.
 *
 * Both writes are gated on `masters.approve` AND a National-Head rank floor the
 * server holds, which no per-company Feature Access override can lift. Pricing
 * a product decides what every ticket ever raised against it is worth, so it is
 * the same shape as force-closure rather than the same shape as editing the
 * catalogue.
 */

import type {
  ApproveProductInput,
  BrandSubmission,
  ProductSubmission,
  RejectProductInput,
} from "@/types/approval";
import type { ListParams, Page } from "@/types/api";
import { apiGet, apiGetPage, apiPost } from "./http";

/**
 * One page of the queue.
 *
 * The server orders pending rows first — longest wait leading, so the vendor
 * who has been blocked longest is at the top — then decided ones, most recent
 * first. Two halves running in opposite directions on one ascending key, so a
 * page can span the boundary.
 *
 * `filters.status` defaults to `pending` server-side: the queue's job is the
 * backlog, not the archive. `all` widens it, and anything unrecognised yields
 * an empty page rather than a 422, because these ride in a shareable query
 * string and an old bookmark must not break the screen.
 */
export function listApprovals(
  params: ListParams = {}
): Promise<Page<ProductSubmission>> {
  return apiGetPage<ProductSubmission>("/masters/approvals", params);
}

/**
 * How many are waiting.
 *
 * Its own endpoint rather than reading `listApprovals().pagination` — the rail
 * renders on every screen, and the page's own query carries whatever filter and
 * search the reader has typed, so sharing it would either fork into a second
 * request or badge the rail with a count of somebody's search results. The same
 * reasoning `unreadNotificationCount` records.
 */
export function pendingApprovalCount(): Promise<number> {
  return apiGet<number>("/masters/approvals/count");
}

/**
 * Price it and let tickets be raised against it.
 *
 * **409 `ALREADY_DECIDED`** means somebody else got there first — two National
 * Heads can have this queue open at once, and without the guard the second set
 * of prices would silently overwrite the first. Refetch rather than retry.
 */
export function approveProduct({
  id,
  technicianPayoutPaise,
  vendorPricePaise,
}: ApproveProductInput): Promise<ProductSubmission> {
  return apiPost<ProductSubmission>(`/masters/models/${id}/approve`, {
    technicianPayoutPaise,
    vendorPricePaise,
  });
}

/**
 * Refuse it, with a reason.
 *
 * Nothing is deleted and no price is written: a rejected product has no agreed
 * figure, and leaving one on a row nobody signed off is worse than leaving
 * none. The vendor sees the reason on their own products screen and in their
 * bell, edits, and submits again.
 */
export function rejectProduct({
  id,
  reason,
}: RejectProductInput): Promise<ProductSubmission> {
  return apiPost<ProductSubmission>(`/masters/models/${id}/reject`, { reason });
}

/* ── brands ──────────────────────────────────────────────────────────────────
 *
 * The same queue's other half: brands a vendor added from its portal. Same
 * guards, same ordering, same `status` filter and the same 409
 * `ALREADY_DECIDED` — only nothing is priced. */

/** One page of vendor-added brands. `filters.status` defaults to `pending`. */
export function listBrandApprovals(
  params: ListParams = {}
): Promise<Page<BrandSubmission>> {
  return apiGetPage<BrandSubmission>("/masters/brand-approvals", params);
}

/** Agree the vendor sells it. Its products may carry it from now on. */
export function approveBrand(id: string): Promise<BrandSubmission> {
  return apiPost<BrandSubmission>(`/masters/brands/${id}/approve`);
}

/** Refuse it, with a reason. The vendor may rename it, which resubmits it. */
export function rejectBrand({
  id,
  reason,
}: RejectProductInput): Promise<BrandSubmission> {
  return apiPost<BrandSubmission>(`/masters/brands/${id}/reject`, { reason });
}
