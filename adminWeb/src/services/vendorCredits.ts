/**
 * Vendor credit transport — live FastAPI. Both sides of one slice.
 *
 * The VENDOR's half (`/vendor-credit/me/…`) carries `vendor.credit` and is
 * seeded to `vendor` and not `vendor_user`: a sub-user raises tickets, settling
 * with the company is a vendor-admin act. No call takes a vendor id — the server
 * pins it from the session (hard rule 0).
 *
 * The STAFF half carries `vendors.credit` AND a National-Head rank floor the
 * server holds, because confirming a payment moves money and raising a line
 * extends credit.
 *
 * **There is no function in the vendor's half that clears what it owes, and
 * there must never be one** — the vendor claims it paid, and only staff confirm.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  ClaimVendorPaymentInput,
  VendorCredit,
  VendorCreditCounts,
  VendorCreditEntry,
  VendorCreditRequest,
  RecordVendorPaymentInput,
  VendorPayment,
  VendorPaymentDetail,
  VendorStanding,
} from "@/types/vendorCredit";
import { apiGet, apiGetPage, apiPost } from "./http";

// ── the vendor's own side ────────────────────────────────────────────────────

/** The line, and what can be done about it. */
export function getMyCredit(): Promise<VendorCredit> {
  return apiGet<VendorCredit>("/vendor-credit/me");
}

/** The statement, newest first. `filters.kind` is `charge` or `payment`. */
export function listMyCreditEntries(
  params: ListParams = {}
): Promise<Page<VendorCreditEntry>> {
  return apiGetPage<VendorCreditEntry>("/vendor-credit/me/entries", params);
}

export function listMyPayments(
  params: ListParams = {}
): Promise<Page<VendorPayment>> {
  return apiGetPage<VendorPayment>("/vendor-credit/me/payments", params);
}

export function getMyPayment(id: string): Promise<VendorPaymentDetail> {
  return apiGet<VendorPaymentDetail>(`/vendor-credit/me/payments/${id}`);
}

/**
 * Ask to pay, and get the QR back with it. Whole rupees, in paise.
 *
 * 409 `PAYMENT_UNAVAILABLE` until the company has a UPI ID, `PAYMENT_OPEN` while
 * one is open, `NOTHING_TO_PAY` when nothing is owed; 422 `BAD_AMOUNT` above
 * what is owed.
 */
export function startMyPayment(amountPaise: number): Promise<VendorPaymentDetail> {
  return apiPost<VendorPaymentDetail>("/vendor-credit/me/payments", { amountPaise });
}

/**
 * "I have paid" — the UTR and the screenshot, both required. The screenshot goes
 * up first through `POST /uploads?kind=attachment`; a blob NAME travels here.
 */
export function claimMyPayment({
  id,
  utr,
  proof,
}: ClaimVendorPaymentInput): Promise<VendorPaymentDetail> {
  return apiPost<VendorPaymentDetail>(`/vendor-credit/me/payments/${id}/claim`, {
    utr,
    proof,
  });
}

/** Withdraw it before claiming. 409 `ALREADY_CLAIMED` after. */
export function cancelMyPayment(id: string): Promise<VendorPaymentDetail> {
  return apiPost<VendorPaymentDetail>(`/vendor-credit/me/payments/${id}/cancel`);
}

export function listMyLimitRequests(): Promise<VendorCreditRequest[]> {
  return apiGet<VendorCreditRequest[]>("/vendor-credit/me/limit-requests");
}

/** Ask for a bigger line. 409 `REQUEST_PENDING` when one is already waiting. */
export function askForLimit(input: {
  requestedLimitPaise: number;
  note?: string;
}): Promise<VendorCreditRequest> {
  return apiPost<VendorCreditRequest>("/vendor-credit/me/limit-requests", input);
}

export function withdrawLimitRequest(id: string): Promise<VendorCreditRequest> {
  return apiPost<VendorCreditRequest>(
    `/vendor-credit/me/limit-requests/${id}/withdraw`
  );
}

// ── the staff side ──────────────────────────────────────────────────────────

/** The two rail badges: claims waiting, and limit requests waiting. */
export function getVendorCreditCounts(): Promise<VendorCreditCounts> {
  return apiGet<VendorCreditCounts>("/vendor-credit/count");
}

/** Every vendor's line, by name. `filters.pausedOnly` narrows the page. */
export function listVendorStandings(
  params: ListParams = {}
): Promise<Page<VendorStanding>> {
  return apiGetPage<VendorStanding>("/vendor-credit/vendors", params);
}

export function getVendorStanding(vendorId: string): Promise<VendorStanding> {
  return apiGet<VendorStanding>(`/vendor-credit/vendors/${vendorId}`);
}

/**
 * The payment queue, or one vendor's history through `filters.vendorId`.
 * `filters.state=waiting` sorts OLDEST first — it is a queue.
 */
export function listVendorPayments(
  params: ListParams = {}
): Promise<Page<VendorPayment>> {
  return apiGetPage<VendorPayment>("/vendor-credit/payments", params);
}

export function getVendorPayment(id: string): Promise<VendorPaymentDetail> {
  return apiGet<VendorPaymentDetail>(`/vendor-credit/payments/${id}`);
}

/**
 * Write down money that arrived by NEFT, RTGS, cheque or cash — anything but the
 * QR. The one call here that moves a line on one person's word.
 *
 * Uncapped (UPI's limit is a fact about one QR), needs no UPI ID on the company,
 * and final the moment it lands. 409 `UTR_ALREADY_CREDITED` when the reference is
 * already credited; 422 `BAD_PROOF` for an attachment from another account.
 */
export function recordVendorPayment({
  vendorId,
  ...body
}: RecordVendorPaymentInput): Promise<VendorPaymentDetail> {
  return apiPost<VendorPaymentDetail>(
    `/vendor-credit/vendors/${vendorId}/payments`,
    body
  );
}

/** It arrived. THE one thing that restores the vendor's headroom. */
export function confirmVendorPayment(id: string): Promise<VendorPaymentDetail> {
  return apiPost<VendorPaymentDetail>(`/vendor-credit/payments/${id}/confirm`);
}

/** It did not arrive, or did not match. Final, and the reason reaches the vendor. */
export function rejectVendorPayment(input: {
  id: string;
  reason: string;
}): Promise<VendorPaymentDetail> {
  return apiPost<VendorPaymentDetail>(
    `/vendor-credit/payments/${input.id}/reject`,
    { reason: input.reason }
  );
}

/** The request queue: pending first, longest-waiting within it. */
export function listVendorLimitRequests(
  params: ListParams = {}
): Promise<Page<VendorCreditRequest>> {
  return apiGetPage<VendorCreditRequest>("/vendor-credit/limit-requests", params);
}

/** Grant a line, at the figure decided here rather than the one asked for. */
export function approveLimitRequest(input: {
  id: string;
  grantedLimitPaise: number;
}): Promise<VendorCreditRequest> {
  return apiPost<VendorCreditRequest>(
    `/vendor-credit/limit-requests/${input.id}/approve`,
    { grantedLimitPaise: input.grantedLimitPaise }
  );
}

export function rejectLimitRequest(input: {
  id: string;
  reason: string;
}): Promise<VendorCreditRequest> {
  return apiPost<VendorCreditRequest>(
    `/vendor-credit/limit-requests/${input.id}/reject`,
    { reason: input.reason }
  );
}
