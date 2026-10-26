/**
 * Technicians — live FastAPI, all of it.
 *
 * `listEligibleTechnicians` used to sit here as the one mock: it answered "who
 * could take this escalated ticket" from a hardcoded roster, because "has
 * bandwidth left" needed a jobs table that did not exist. It does now — the
 * daily cap counts by slot date — so the question is answered by
 * `listCandidateTechnicians` below, against the same predicate the assignment
 * call enforces. Two shortlists for one question was one too many.
 */

import { apiDelete, apiGetPage, apiGet, apiPost, apiPut } from "./http";
import type { ListParams, Page } from "@/types/api";
import type { BaseLocation, BaseLocationInput } from "@/types/allowances";
import type {
  AppLinkOutcome,
  CreatedTechnician,
  CreateTechnicianInput,
  DistrictBreakdown,
  InviteTechnicianInput,
  Technician,
  TechnicianInvite,
  TechnicianRow,
  TechnicianTransfer,
  TechnicianTransferInput,
  TechnicianTransferResult,
  UpdateTechnicianInput,
  UpiChange,
} from "@/types/technician";

/**
 * One page of the Technicians screen — registered technicians AND open invites.
 *
 * The union happens on the server, so the page size is a real page size. Two
 * endpoints stitched together in the browser would give neither list's.
 */
export function listTechnicians(
  params: ListParams = {}
): Promise<Page<TechnicianRow>> {
  return apiGetPage<TechnicianRow>("/technicians", params);
}

export function getTechnician(id: string): Promise<Technician> {
  return apiGet<Technician>(`/technicians/${id}`);
}

/**
 * Move a technician's base (Task 10 §4.7) — a bare pincode, or a map / typed
 * point. There is no delete: a base is moved, never removed. Staff
 * `technicians.edit` on a HOME technician they manage; a visible non-home one
 * answers 403 "Managed by …".
 */
export function setBaseLocation({
  id,
  body,
}: {
  id: string;
  body: BaseLocationInput;
}): Promise<BaseLocation> {
  return apiPut<BaseLocation>(`/technicians/${id}/base-location`, body);
}

/**
 * How many technicians work in each district of one state.
 *
 * Scoped like the list itself, so a district's number always matches the rows
 * behind it — an area manager counts only the technicians he can already see.
 *
 * **The counts do not sum to `totalTechnicians`.** A pincode can belong to
 * several districts at once, so a technician covering one is genuinely present
 * in each. Anything presenting these as a partition of the state is wrong; see
 * `DistrictBreakdown`.
 */
export function getDistrictBreakdown(
  stateId: string
): Promise<DistrictBreakdown> {
  return apiGet<DistrictBreakdown>(
    `/technicians/districts?stateId=${encodeURIComponent(stateId)}`
  );
}

/**
 * Add a technician directly. The server then WhatsApps them the app link, after
 * the save — so the reply carries whether that went, and a refusal never undoes
 * the technician.
 */
export function createTechnician(
  input: CreateTechnicianInput
): Promise<CreatedTechnician> {
  return apiPost<CreatedTechnician>("/technicians", input);
}

/**
 * WhatsApp a registered technician the app link again. Writes nothing — the
 * outcome comes back, it is not kept anywhere.
 */
export function sendAppLink(id: string): Promise<AppLinkOutcome> {
  return apiPost<AppLinkOutcome>(`/technicians/${id}/app-link`);
}

export function updateTechnician({
  id,
  ...body
}: UpdateTechnicianInput): Promise<Technician> {
  return apiPut<Technician>(`/technicians/${id}`, body);
}

export function deleteTechnician(id: string): Promise<null> {
  return apiDelete<null>(`/technicians/${id}`);
}

/* ---------------------------------------------------------- UPI changes */

/** The change waiting on this technician, or null. Territory-scoped: 404 outside it. */
export function getUpiChange(id: string): Promise<UpiChange | null> {
  return apiGet<UpiChange | null>(`/technicians/${id}/upi-change`);
}

/**
 * Apply the new UPI ID and name — no code, the manager is the check. 409
 * `NO_PENDING_CHANGE` when a colleague decided it, or the technician withdrew
 * it, a moment ago.
 */
export function approveUpiChange(id: string): Promise<UpiChange> {
  return apiPost<UpiChange>(`/technicians/${id}/upi-change/approve`);
}

/** Refuse it, with a reason the technician reads. Their UPI ID stays. */
export function rejectUpiChange({
  id,
  reason,
}: {
  id: string;
  reason: string;
}): Promise<UpiChange> {
  return apiPost<UpiChange>(`/technicians/${id}/upi-change/reject`, { reason });
}

/* --------------------------------------------------------------- invites */

export function inviteTechnician(
  input: InviteTechnicianInput
): Promise<TechnicianInvite> {
  return apiPost<TechnicianInvite>("/technicians/invites", input);
}

export function resendInvite(id: string): Promise<TechnicianInvite> {
  return apiPost<TechnicianInvite>(`/technicians/invites/${id}/resend`);
}

export function cancelInvite(id: string): Promise<null> {
  return apiDelete<null>(`/technicians/invites/${id}`);
}

/* ------------------------------------------------------- escalation only */

/* ------------------------------------------------- one ticket's shortlist */

/**
 * Who could take THIS ticket. Live, unlike `listEligibleTechnicians` above.
 *
 * The server already filters on both halves of the question — `GET
 * /technicians` takes `subcategoryId` and `pincode` — so this is the real
 * shortlist rather than the escalation mock's invented one: registered, active,
 * certified for the ticket's subcategory, covering its pincode, and inside the
 * reader's own territory, because the list is scoped there already.
 *
 * `slotStart` moves what `bwUsed` counts to the day the WORK happens, which is
 * the only day the assignment call cares about — the cap is enforced by slot
 * date. Without it a shortlist for a Friday job reports each technician's
 * MONDAY load, the manager picks somebody who looks free, and the assign call
 * refuses them at cap: the console and the API disagreeing about one person in
 * the space of a click. Omitted, the server counts today, which is what the
 * Technicians screen wants.
 *
 * It still does not FILTER on capacity. A technician who is full that day
 * belongs on the list showing as full — "why is nobody available" is a
 * question the screen has to be able to answer, and an empty table answers it
 * with silence.
 *
 * One page of 100, the API's ceiling, and unpaginated on screen: this is the
 * shortlist for one subcategory in one pincode, read while a manager decides.
 * A candidate on page 2 is a candidate nobody considers.
 */
export function listCandidateTechnicians(input: {
  subcategoryId: string;
  /** Omitted for a ticket that was HANDED to another franchisee (Task 18): its
   *  pincode belongs to a franchisee whose technicians cannot take it, and
   *  filtering by it would list nobody. */
  pincode?: string;
  /** The receiving franchisee, sent instead of the pincode for a handed ticket
   *  — `GET /technicians` has always taken `franchiseeId` (Task 05). */
  franchiseeId?: string;
  slotStart?: string | null;
}): Promise<Technician[]> {
  return apiGetPage<TechnicianRow>("/technicians", {
    limit: 100,
    filters: {
      view: "registered",
      status: "active",
      subcategoryId: input.subcategoryId,
      ...(input.pincode ? { pincode: input.pincode } : {}),
      ...(input.franchiseeId ? { franchiseeId: input.franchiseeId } : {}),
      ...(input.slotStart ? { onDay: input.slotStart } : {}),
    },
  }).then(({ rows }) => rows.filter((row): row is Technician => row.registered));
}

/* ------------------------------------------- moving between franchisees */

/**
 * What a move WOULD do (Task 17). A preview answers 200 even when something is in
 * the way — the blockers are data — and writes nothing, so it is safe to call as
 * often as the person changes their mind. `reason` is not needed for it.
 */
export function previewTransfer({
  id,
  body,
}: {
  id: string;
  body: TechnicianTransferInput;
}): Promise<TechnicianTransferResult> {
  return apiPost<TechnicianTransferResult>(
    `/technicians/${id}/transfer?dryRun=true`,
    body
  );
}

/**
 * Move them. The first blocker is raised as the error instead — 409
 * `TECHNICIAN_HAS_OPEN_JOBS` / `TECHNICIAN_HAS_BALANCE` / `FRANCHISEE_HAS_NO_ADMIN`
 * (or code-less), 422 `PINCODE_OUTSIDE_FRANCHISEE` — so a race the preview could
 * not see still lands as a sentence.
 */
export function transferTechnician({
  id,
  body,
}: {
  id: string;
  body: TechnicianTransferInput;
}): Promise<TechnicianTransferResult> {
  return apiPost<TechnicianTransferResult>(
    `/technicians/${id}/transfer?dryRun=false`,
    body
  );
}

/** Every move this technician has had, newest first. Staff only. */
export function getTransfers(id: string): Promise<TechnicianTransfer[]> {
  return apiGet<TechnicianTransfer[]>(`/technicians/${id}/transfers`);
}
