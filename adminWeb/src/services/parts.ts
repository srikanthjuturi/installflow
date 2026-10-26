/**
 * Spare parts transport — live FastAPI (Task 12), Task 13 §5.3.
 *
 * Three doors, three audiences that never meet:
 *
 *   * `/spare-parts/catalogue/*` — company Admin / National Head
 *     (`parts.catalogue`), the editor on Categories & products;
 *   * `/spare-parts/requests/*` — franchise staff ONLY (`parts.handle`; owner
 *     ruling 2026-10-15, R4: every staff role is 403, home included);
 *   * `/spare-parts/home-facility-users` — Admin / National Head giving the
 *     HOME franchisee its first facility user (`franchisees.manage`).
 *
 * Hiding a control is presentation, never authorization — the server decides.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  Catalogue,
  CatalogueOwner,
  PartRequest,
  PartRequestCounts,
  SparePart,
} from "@/types/parts";
import { facilityUserSource, type FacilityUserSource } from "./facilityUsers";
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from "./http";

/* ── the catalogue ───────────────────────────────────────────────────────── */

const ownerPath = (o: CatalogueOwner) =>
  o.kind === "node" ? `nodes/${o.id}` : `models/${o.id}`;

export function getCatalogue(owner: CatalogueOwner): Promise<Catalogue> {
  return apiGet<Catalogue>(`/spare-parts/catalogue/${ownerPath(owner)}`);
}

export function addPart(
  owner: CatalogueOwner,
  name: string
): Promise<SparePart> {
  return apiPost<SparePart>(
    `/spare-parts/catalogue/${ownerPath(owner)}/parts`,
    { name }
  );
}

/** Omit a field to leave it alone. */
export function updatePart(
  id: string,
  body: { name?: string; isActive?: boolean }
): Promise<SparePart> {
  return apiPatch<SparePart>(`/spare-parts/catalogue/parts/${id}`, body);
}

/** A soft delete — requests that already name the part keep their frozen label. */
export function removePart(id: string): Promise<null> {
  return apiDelete<null>(`/spare-parts/catalogue/parts/${id}`);
}

/* ── the facility's queue ────────────────────────────────────────────────── */

/**
 * `status` travels in `params.filters.status` as a comma-set; absent, the
 * server answers its default desk (`requested,approved,issued`, D22) — the
 * queue's *On the desk* pill sends nothing.
 */
export function listPartRequests(
  params: ListParams = {}
): Promise<Page<PartRequest>> {
  return apiGetPage<PartRequest>("/spare-parts/requests", params);
}

export function getPartRequestCounts(): Promise<PartRequestCounts> {
  return apiGet<PartRequestCounts>("/spare-parts/requests/counts");
}

/** Read fresh: it carries the return photo's signed link (15 minutes). */
export function getPartRequest(id: string): Promise<PartRequest> {
  return apiGet<PartRequest>(`/spare-parts/requests/${id}`);
}

export function approvePartRequest(
  id: string,
  body: { addToCatalogue: boolean }
): Promise<PartRequest> {
  return apiPost<PartRequest>(`/spare-parts/requests/${id}/approve`, body);
}

/** Valid from `requested` AND from `approved` (R2); the reason is required both times. */
export function rejectPartRequest(
  id: string,
  body: { reason: string }
): Promise<PartRequest> {
  return apiPost<PartRequest>(`/spare-parts/requests/${id}/reject`, body);
}

export function issuePartRequest(
  id: string,
  body: { note?: string | null }
): Promise<PartRequest> {
  return apiPost<PartRequest>(`/spare-parts/requests/${id}/issue`, body);
}

/** `photoBlobName` is the blob NAME `POST /uploads?kind=attachment` returned. */
export function returnPartRequest(
  id: string,
  body: { note?: string | null; photoBlobName?: string | null }
): Promise<PartRequest> {
  return apiPost<PartRequest>(`/spare-parts/requests/${id}/return`, body);
}

/* ── the home franchisee's facility users (Admin / National Head) ────────── */

/**
 * The same four calls and shapes as the portal's `/franchise/facility-users`,
 * under a prefix with NO franchisee id: the server resolves the company's home.
 */
export const homeFacilityUsers: FacilityUserSource = facilityUserSource(
  "/spare-parts/home-facility-users"
);
