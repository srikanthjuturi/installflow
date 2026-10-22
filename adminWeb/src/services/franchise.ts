/**
 * The franchise portal's transport — Task 09 §5.3.
 *
 * Every function here reaches a `/franchise/*` door, and every one of those
 * doors answers through `require_franchise_principal` + a `franchise.*` key
 * (the routers under `api/app/features`), so the wall is the backend's:
 * nothing here sends a franchisee id, because `GET /franchise/…` is already
 * pinned to the principal's own (F7) — a client that could name one would be a
 * tenancy hole, not a feature.
 *
 * The response shapes are deliberately the STAFF twins': `TechnicianRow`,
 * `StaffRedemptionOut`, `LedgerEntryOut` — the doc §5.2 rejects forking the
 * screens, and forking the types would be forking them by another name. The
 * two additions the portal's screens need that staff rows do not carry (who a
 * UPI change is about; the subcategory picker), plus the pincode and statement
 * shapes, are the only types `types/franchise.ts` owns.
 */

import { apiDelete, apiGet, apiGetBlob, apiGetPage, apiPost, apiPut } from "./http";
import type { ListParams, Page } from "@/types/api";
import type {
  AppLinkOutcome,
  CreatedTechnician,
  CreateTechnicianInput,
  InviteTechnicianInput,
  Technician,
  TechnicianInvite,
  TechnicianRow,
  UpdateTechnicianInput,
  UpiChange,
} from "@/types/technician";
import type { Redemption, RedemptionDetail } from "@/types/redemption";
import type { LedgerEntry } from "@/types";
import type { LedgerPool } from "./ledger";
import type {
  FranchisePincode,
  TechnicianOptions,
  UpiChangeRow,
} from "@/types/franchise";

/* ------------------------------------------------------------- the roster */

/** The staff list, pinned to the principal's franchisee — same params, minus franchiseeId. */
export function listTechnicians(
  params: ListParams = {}
): Promise<Page<TechnicianRow>> {
  return apiGetPage<TechnicianRow>("/franchise/technicians", params);
}

export function getTechnician(id: string): Promise<Technician> {
  return apiGet<Technician>(`/franchise/technicians/${id}`);
}

export function createTechnician(
  input: CreateTechnicianInput
): Promise<CreatedTechnician> {
  return apiPost<CreatedTechnician>("/franchise/technicians", input);
}

export function sendAppLink(id: string): Promise<AppLinkOutcome> {
  return apiPost<AppLinkOutcome>(`/franchise/technicians/${id}/app-link`);
}

export function updateTechnician({
  id,
  ...body
}: UpdateTechnicianInput): Promise<Technician> {
  return apiPut<Technician>(`/franchise/technicians/${id}`, body);
}

export function deleteTechnician(id: string): Promise<null> {
  return apiDelete<null>(`/franchise/technicians/${id}`);
}

export function inviteTechnician(
  input: InviteTechnicianInput
): Promise<TechnicianInvite> {
  return apiPost<TechnicianInvite>("/franchise/technicians/invites", input);
}

export function resendInvite(id: string): Promise<TechnicianInvite> {
  return apiPost<TechnicianInvite>(`/franchise/technicians/invites/${id}/resend`);
}

export function cancelInvite(id: string): Promise<null> {
  return apiDelete<null>(`/franchise/technicians/invites/${id}`);
}

/* ------------------------------------------------------------ UPI changes */

/** The change waiting on this technician, or null. 404 outside the franchisee. */
export function getUpiChange(id: string): Promise<UpiChange | null> {
  return apiGet<UpiChange | null>(`/franchise/technicians/${id}/upi-change`);
}

export function approveUpiChange(id: string): Promise<UpiChange> {
  return apiPost<UpiChange>(`/franchise/technicians/${id}/upi-change/approve`);
}

export function rejectUpiChange({
  id,
  reason,
}: {
  id: string;
  reason: string;
}): Promise<UpiChange> {
  return apiPost<UpiChange>(`/franchise/technicians/${id}/upi-change/reject`, {
    reason,
  });
}

/**
 * This franchisee's change requests — the queue page's rows. `filters.state`
 * carries `pending | approved | rejected`; absent is everything. Unknown →
 * empty page, never a 422, because it rides a shareable query string.
 */
export function listUpiChanges(
  params: ListParams = {}
): Promise<Page<UpiChangeRow>> {
  return apiGetPage<UpiChangeRow>("/franchise/upi-changes", params);
}

/** How many are waiting on this franchisee — the rail badge. */
export async function upiChangesPendingCount(): Promise<number> {
  const { pending } = await apiGet<{ pending: number }>(
    "/franchise/upi-changes/count"
  );
  return pending;
}

/* ------------------------------------------------- the Add form's pickers */

/** Both pickers of the technician form, narrowed to this franchisee. */
export function getTechnicianOptions(): Promise<TechnicianOptions> {
  return apiGet<TechnicianOptions>("/franchise/technician-options");
}

/**
 * This franchisee's pincodes — the coverage picker. `search` is a code prefix;
 * `regionId` narrows to one region the options endpoint named. Pages of its
 * own (page/limit, not the list language's `page` inside `ListParams`), because
 * a franchisee can hold hundreds of codes.
 */
export function listFranchisePincodes(params: {
  page: number;
  limit: number;
  search?: string;
  regionId?: string;
}): Promise<Page<FranchisePincode>> {
  return apiGetPage<FranchisePincode>("/franchise/pincodes", params);
}

/* ------------------------------------------------------------ redemptions */

/** This franchisee's payout queue, in the staff list's own shape. */
export function listRedemptions(
  params: ListParams = {}
): Promise<Page<Redemption>> {
  return apiGetPage<Redemption>("/franchise/redemptions", params);
}

/** How many of this franchisee's payouts nobody has paid yet — the rail badge. */
export async function redemptionsToPayCount(): Promise<number> {
  const { toPay } = await apiGet<{ toPay: number }>("/franchise/redemptions/count");
  return toPay;
}

export function getRedemption(id: string): Promise<RedemptionDetail> {
  return apiGet<RedemptionDetail>(`/franchise/redemptions/${id}`);
}

/**
 * "I paid" — the screenshot goes up first, the UTR is optional, and the
 * technician's confirmation is still the only thing that settles it. This
 * transport has no confirm function because the backend has no such route;
 * see `services/redemptions.ts`'s header for why there is never one.
 */
export function claimRedemption({
  id,
  proof,
  utr,
}: {
  id: string;
  proof: { blobName: string; fileName?: string };
  utr?: string;
}): Promise<RedemptionDetail> {
  return apiPost<RedemptionDetail>(`/franchise/redemptions/${id}/claim`, {
    proof,
    ...(utr ? { utr } : {}),
  });
}

export function declineRedemption({
  id,
  reason,
}: {
  id: string;
  reason: string;
}): Promise<RedemptionDetail> {
  return apiPost<RedemptionDetail>(`/franchise/redemptions/${id}/decline`, {
    reason,
  });
}

/* ------------------------------------------------------ the penalty pool */

/** This franchisee's balance, and the two sums it is the difference of. */
export function getLedgerPool(): Promise<LedgerPool> {
  return apiGet<LedgerPool>("/franchise/ledger/pool");
}

/**
 * This franchisee's pool movements, newest first — the server's order,
 * accepted and not renegotiable from here. `filters.kind` is the same three
 * words the staff screen uses.
 *
 * `sortBy`/`sortDir` are NOT sent: the franchise door accepts and ignores
 * them on purpose, and a client that sent them would only be rehearsing a
 * second sort contract the backend refuses to honour.
 */
export function listLedgerEntries(
  params: ListParams = {}
): Promise<Page<LedgerEntry>> {
  return apiGetPage<LedgerEntry>("/franchise/ledger", {
    ...params,
    sortBy: undefined,
    sortDir: undefined,
  });
}

/**
 * Give one of OUR penalties back, in full, with a reason — the pool screen's
 * Reverse action. Once only: 409 `PENALTY_ALREADY_REVERSED` on a second call,
 * exactly as the staff ticket door behaves.
 */
export function reverseLedgerEntry({
  id,
  reason,
}: {
  id: string;
  reason: string;
}): Promise<LedgerEntry> {
  return apiPost<LedgerEntry>(`/franchise/ledger/${id}/reverse`, { reason });
}

/* ------------------------------------------------------------- statements */

/**
 * One employee's month as the payroll reads it — the raw CSV, BOM included.
 *
 * The CORS header is not exposed (deliberately, `api/app/features/franchise_portal/router.py`),
 * so the caller names the download itself through `utils/statements.ts`'s
 * builder rather than trusting `Content-Disposition`. Failures arrive as the
 * standard envelope, which `apiGetBlob` already reads.
 */
export function getStatement(technicianId: string, month: string): Promise<Blob> {
  return apiGetBlob(
    `/franchise/statements/${technicianId}?month=${encodeURIComponent(month)}`
  );
}