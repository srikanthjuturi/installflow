/**
 * Credits transport — live FastAPI, the company's side.
 *
 * Admin and National Head only: every call carries `credits.manage` AND a
 * National-Head rank floor the server holds, because a recharge spends company
 * money. **There is no function here that adds credits, and there must never be
 * one** — the company claims it paid, and only the superadmin confirms
 * (`services/platform.ts`).
 */

import type { ListParams, Page } from "@/types/api";
import type {
  ClaimRechargeInput,
  CreditEntry,
  CreditSummary,
  Recharge,
  RechargeDetail,
} from "@/types/credits";
import { apiGet, apiGetPage, apiPost } from "./http";

/** The balance, the rules it is spent under, and the open recharge if any. */
export function getCredits(): Promise<CreditSummary> {
  return apiGet<CreditSummary>("/credits");
}

/** The statement, newest first. `filters.kind` is `free`, `ticket` or `recharge`. */
export function listCreditEntries(params: ListParams = {}): Promise<Page<CreditEntry>> {
  return apiGetPage<CreditEntry>("/credits/entries", params);
}

/** The company's recharges, newest first. `filters.state` narrows them. */
export function listRecharges(params: ListParams = {}): Promise<Page<Recharge>> {
  return apiGetPage<Recharge>("/credits/recharges", params);
}

export function getRecharge(id: string): Promise<RechargeDetail> {
  return apiGet<RechargeDetail>(`/credits/recharges/${id}`);
}

/**
 * Start a recharge and get its QR. Whole rupees.
 *
 * 422 `BAD_AMOUNT` outside the rules' bounds; 409 `RECHARGE_UNAVAILABLE` until
 * the platform has a UPI ID, and `RECHARGE_OPEN` while another is open.
 */
export function createRecharge(amountRupees: number): Promise<RechargeDetail> {
  return apiPost<RechargeDetail>("/credits/recharges", { amountRupees });
}

/**
 * "We paid" — the UTR and the screenshot, both required. The screenshot goes up
 * first through `POST /uploads?kind=attachment`; a blob NAME travels here.
 * Once only: 409 `ALREADY_CLAIMED` after that.
 */
export function claimRecharge({
  id,
  utr,
  proof,
}: ClaimRechargeInput): Promise<RechargeDetail> {
  return apiPost<RechargeDetail>(`/credits/recharges/${id}/claim`, { utr, proof });
}

/** Withdraw it before paying. 409 `ALREADY_CLAIMED` once the payment is submitted. */
export function cancelRecharge(id: string): Promise<RechargeDetail> {
  return apiPost<RechargeDetail>(`/credits/recharges/${id}/cancel`);
}
