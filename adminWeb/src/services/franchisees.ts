/**
 * Franchisee transport — live FastAPI (Task 03).
 *
 * Mirrors `services/vendors.ts`. The screen's write gate is `franchisees.manage`
 * and the read gate `franchisees.view`, both enforced by the API; hiding a
 * button here is presentation, not authorization.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  CreatedFranchiseeAdmin,
  Franchisee,
  FranchiseeAdmin,
  FranchiseeInput,
  FranchiseeOption,
  PincodeChange,
} from "@/types/franchisee";
import { apiGet, apiGetPage, apiPost, apiPut } from "./http";

export function listFranchisees(
  params: ListParams = {}
): Promise<Page<Franchisee>> {
  return apiGetPage<Franchisee>("/franchisees", params);
}

/**
 * Every franchisee for pickers and filters — unpaginated, active and inactive,
 * because a paused franchisee's technicians still have to be listed and
 * filtered truthfully. Not the same rule as `vendors/options`, which drops
 * paused vendors: there the list feeds NEW attributions; here it names who
 * already owns a technician.
 */
export function listFranchiseeOptions(): Promise<FranchiseeOption[]> {
  return apiGet<FranchiseeOption[]>("/franchisees/options");
}

export function getFranchisee(id: string): Promise<Franchisee> {
  return apiGet<Franchisee>(`/franchisees/${id}`);
}

export function createFranchisee(input: FranchiseeInput): Promise<Franchisee> {
  return apiPost<Franchisee>("/franchisees", input);
}

export function updateFranchisee({
  id,
  ...body
}: { id: string } & FranchiseeInput): Promise<Franchisee> {
  return apiPut<Franchisee>(`/franchisees/${id}`, body);
}

/**
 * The dry run: writes nothing and answers 200 even with clashes (it lists
 * them). The reply is the plan; the apply below is the only thing that writes.
 */
export function previewPincodes({
  id,
  pincodeRanges,
}: {
  id: string;
  pincodeRanges: string;
}): Promise<PincodeChange> {
  return apiPut<PincodeChange>(`/franchisees/${id}/pincodes?dryRun=true`, {
    pincodeRanges,
  });
}

/**
 * The apply. On success this reply — not the earlier preview — is the
 * authoritative summary, so its counts are what the toast reports. Clashes
 * make it a 409 `FRANCHISEE_PINCODE_TAKEN` instead.
 */
export function savePincodes({
  id,
  pincodeRanges,
}: {
  id: string;
  pincodeRanges: string;
}): Promise<PincodeChange> {
  return apiPut<PincodeChange>(
    `/franchisees/${id}/pincodes?dryRun=false`,
    { pincodeRanges }
  );
}

/**
 * Deactivate. Releases every pincode back to the home — with the F6 rule, open
 * unassigned tickets re-stamped to home — and deactivates its franchise-role
 * memberships. Refused while it still has technicians (409
 * `FRANCHISEE_HAS_TECHNICIANS`, count in the message) and on the home.
 */
export function deactivateFranchisee(id: string): Promise<Franchisee> {
  return apiPost<Franchisee>(`/franchisees/${id}/deactivate`);
}

/**
 * Activate. It comes back owning no pincodes — deactivation handed them back —
 * so the success toast names the next step.
 */
export function activateFranchisee(id: string): Promise<Franchisee> {
  return apiPost<Franchisee>(`/franchisees/${id}/activate`);
}

/* ── franchisee admins ───────────────────────────────────────────────────── */

export function listFranchiseeAdmins(id: string): Promise<FranchiseeAdmin[]> {
  return apiGet<FranchiseeAdmin[]>(`/franchisees/${id}/admins`);
}

export function addFranchiseeAdmin({
  franchiseeId,
  fullName,
  email,
  phone,
}: {
  franchiseeId: string;
  fullName: string;
  email: string;
  phone: string;
}): Promise<CreatedFranchiseeAdmin> {
  return apiPost<CreatedFranchiseeAdmin>(`/franchisees/${franchiseeId}/admins`, {
    fullName,
    email,
    phone,
  });
}

/**
 * The server refuses with 409 `FRANCHISEE_LAST_ADMIN` when this is the only
 * active admin of a NON-home franchisee — the row is disabled with the same
 * sentence, so this only fires off a list that went stale between the render
 * and the click (Task 08 §5.5).
 */
export function deactivateFranchiseeAdmin({
  franchiseeId,
  membershipId,
}: {
  franchiseeId: string;
  membershipId: string;
}): Promise<FranchiseeAdmin> {
  return apiPost<FranchiseeAdmin>(
    `/franchisees/${franchiseeId}/admins/${membershipId}/deactivate`
  );
}

export function activateFranchiseeAdmin({
  franchiseeId,
  membershipId,
}: {
  franchiseeId: string;
  membershipId: string;
}): Promise<FranchiseeAdmin> {
  return apiPost<FranchiseeAdmin>(
    `/franchisees/${franchiseeId}/admins/${membershipId}/activate`
  );
}

/**
 * Email this admin a fresh temporary password, ending their sessions. The only
 * way back in for a console login staff do not own — and for one who never got
 * the first email at all.
 */
export function reissueFranchiseeAdminPassword({
  franchiseeId,
  membershipId,
}: {
  franchiseeId: string;
  membershipId: string;
}): Promise<CreatedFranchiseeAdmin> {
  return apiPost<CreatedFranchiseeAdmin>(
    `/franchisees/${franchiseeId}/admins/${membershipId}/reissue-password`
  );
}