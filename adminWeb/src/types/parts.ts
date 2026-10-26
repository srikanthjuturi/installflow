/**
 * Spare parts — Task 13 §5.3, copied from Task 12 §4 as built
 * (`api/app/core/part_request_out.py`, `features/spare_parts/schemas.py`,
 * `core/facility_users.py`).
 *
 * No money anywhere (P5): a part request is a log of who did what and when.
 */

import type { EmailOutcome } from "./user";

/* ── requests ────────────────────────────────────────────────────────────── */

/**
 * `spare_part_requests.status`, in the order the queue's pills run and the
 * server sorts a desk: requested, approved, issued, returned, rejected.
 */
export const PART_REQUEST_STATUSES = [
  "requested",
  "approved",
  "issued",
  "returned",
  "rejected",
] as const;

export type PartRequestStatus = (typeof PART_REQUEST_STATUSES)[number];

/**
 * What a facility user can do to a request. `allowedActions` on the wire is a
 * list of these words — and the server may one day send one this build has
 * never heard of, which `partStatus.actionsFor` drops rather than draws.
 */
export type PartAction = "approve" | "reject" | "issue" | "return";

/** `PartRequestOut`. No customer name, phone or address (D21). */
export interface PartRequest {
  id: string;
  /** `RGT-SPR-0009`. */
  code: string;
  status: PartRequestStatus;
  /** The server's state machine, forward steps first and `reject` last. */
  allowedActions: string[];
  ticketId: string;
  ticketCode: string;
  ticketStatus: string;
  productLabel: string;
  city: string;
  pincode: string;
  franchiseeId: string;
  franchiseeName: string;
  technicianId: string;
  technicianName: string;
  technicianPhone: string | null;
  sparePartId: string | null;
  /** The frozen label — what the technician picked or typed. */
  partName: string;
  /** No catalogue row behind it: an Other request not yet linked. */
  isOther: boolean;
  /**
   * Only while an Other request is `requested`: where *Add "{name}" to
   * {nodeName}'s parts list* would put it (P7).
   */
  catalogueTarget: { nodeId: string; nodeName: string } | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
  /** Owner ruling 2026-10-15 (R2): rejected after it had been approved. */
  rejectedAfterApproval: boolean;
  issuedAt: string | null;
  issuedBy: string | null;
  issueNote: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  returnNote: string | null;
  /** Signed per read, 15 minutes; null when there is no photo. */
  returnPhotoUrl: string | null;
}

/** `GET /spare-parts/requests/counts` — what is still on this facility's desk. */
export interface PartRequestCounts {
  requested: number;
  approved: number;
  issued: number;
}

/* ── the catalogue ───────────────────────────────────────────────────────── */

/** `SparePartOut` — one catalogue row, with the level it sits on. */
export interface SparePart {
  id: string;
  name: string;
  isActive: boolean;
  ownerKind: "node" | "model";
  ownerId: string;
  ownerName: string;
}

/** `CatalogueOut`. */
export interface Catalogue {
  owner: {
    kind: "node" | "model";
    id: string;
    name: string;
    /** The category names ABOVE the owner, root first. */
    path: string[];
  };
  /** This owner's OWN rows — active and inactive alike. */
  own: SparePart[];
  /** What it inherits from above, merged (deepest wins), active only. */
  inherited: SparePart[];
}

/** Which row of the product master a catalogue belongs to. */
export type CatalogueOwner = { kind: "node" | "model"; id: string };

/* ── facility users ──────────────────────────────────────────────────────── */

export type FacilityRole = "facility_admin" | "facility_operator";

/** `FacilityUserOut`. */
export interface FacilityUser {
  /** The MEMBERSHIP id — what the routes take. */
  membershipId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: FacilityRole;
  isActive: boolean;
  createdAt: string;
}

/** `FacilityUserCreatedOut` — `POST` and `reissue-password`. */
export type CreatedFacilityUser = FacilityUser & EmailOutcome;

/** Body for `POST …/facility-users`. No password: the server mints and emails one. */
export interface CreateFacilityUserInput {
  fullName: string;
  email: string;
  /** E.164, required. */
  phone: string;
  role: FacilityRole;
}
