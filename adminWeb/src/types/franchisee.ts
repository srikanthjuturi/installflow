/**
 * Franchisee domain types — mirror the backend's `FranchiseeOut` family
 * (`api/app/features/franchisees/schemas.py`, Task 03). Used by the Franchisees
 * screen (Task 08) and the technician screens' Franchisee filter.
 */

import type { EmailOutcome } from "./user";

/** `internal` — part of the company; `external` — a separate business. */
export type FranchiseeKind = "internal" | "external";

/**
 * One franchisee, as the list and the detail both render it.
 *
 * `pincodeRanges` is the server's own `compress()` of what it stores — never
 * recomputed in the browser. On the home it is always "" (it owns everything
 * unclaimed, which no range spells out), and `pincodeCount` is a real COUNT:
 * for the home, active master codes no other franchisee owns. The client
 * neither derives nor fakes that number (root AGENTS — and Task 08 §8 trap 9).
 */
export interface Franchisee {
  id: string;
  /** Stamped once, never recomputed — e.g. `SKY`; the home's is `HOME`. */
  code: string;
  name: string;
  kind: FranchiseeKind;
  isHome: boolean;
  contactName: string | null;
  /** E.164 on the wire — render through `formatPhone`. */
  contactPhone: string | null;
  contactEmail: string | null;
  isActive: boolean;
  /** Compressed ranges, e.g. "500030-500040". "" when none (or on the home). */
  pincodeRanges: string;
  pincodeCount: number;
  /** Registered technicians — a live COUNT, not a cached one. */
  technicianCount: number;
  /** Open (live) invites. */
  openInviteCount: number;
  /** Active franchisee_admin memberships. */
  adminCount: number;
  createdAt: string;
}

/** Any franchisee, for pickers and filters — no counts. Carries the `code`. */
export interface FranchiseeOption {
  id: string;
  name: string;
  /** The short code, so two identically-named franchisees stay distinguishable. */
  code: string;
  kind: FranchiseeKind;
  isHome: boolean;
  isActive: boolean;
}

/**
 * Body for `POST /franchisees` (name, kind, contactName, contactPhone required;
 * contactEmail optional) and `PUT /franchisees/{id}` (every field optional —
 * omit to leave alone; `contactEmail` sent as null clears it). There is NO
 * pincodes field: create and pincodes are deliberately two calls (Task 08 §4.1),
 * so the dry run always has a franchisee id to diff against.
 */
export interface FranchiseeInput {
  name?: string;
  kind?: FranchiseeKind;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string | null;
}

/* ── the carve-out preview (and the commit's authoritative reply) ────────── */

/** A set of pincodes as a count plus its compressed display form. */
export interface RangeSet {
  count: number;
  ranges: string;
}

/** A pincode another franchisee already owns — blocks apply, previews list it. */
export interface PincodeClash {
  pincode: string;
  franchiseeId: string;
  franchiseeName: string;
}

/**
 * A technician whose whole coverage is inside the changed set. On an addition
 * they move FROM another franchisee into this one; on a removal they move to
 * the home franchisee (so `fromFranchiseeName` is then THIS franchisee's name).
 */
export interface MovedTechnician {
  id: string;
  code: string;
  name: string | null;
  fromFranchiseeId: string;
  fromFranchiseeName: string;
  toFranchiseeId: string;
  toFranchiseeName: string;
  pincodeCount: number;
}

/** A technician who keeps only part of their coverage after the change. */
export interface TrimmedTechnician {
  id: string;
  code: string;
  name: string | null;
  fromFranchiseeId: string;
  fromFranchiseeName: string;
  /** The codes changing hands, sorted. */
  losing: string[];
  /** How many pincodes they keep. */
  keepingCount: number;
}

/** One open, unassigned ticket the change re-stamps (a sample — at most 20). */
export interface RestampedTicket {
  id: string;
  code: string;
  pincode: string;
  fromFranchiseeName: string;
}

export interface RestampedTickets {
  count: number;
  sample: RestampedTicket[];
}

/**
 * `PUT /franchisees/{id}/pincodes` — the same shape for the dry run and for the
 * commit. The dry run writes nothing; the commit's reply IS the authoritative
 * summary (there is no preview digest — see Task 08 §4.1), so the success toast
 * reports these counts and not the preview's.
 */
export interface PincodeChange {
  dryRun: boolean;
  franchiseeId: string;
  /** The server's normalised compress() of what will be / was stored. */
  pincodeRanges: string;
  /** Codes in the ranges that exist in the master and are active. */
  resolvedCount: number;
  /** Numerically inside the ranges but not in the master / inactive. */
  unknownCount: number;
  /** Entries that matched no code — informational; the UI summarises the count. */
  emptyRanges: string[];
  /** Codes being added to this franchisee. */
  added: RangeSet;
  /** Codes handed back to the home franchisee. */
  removed: RangeSet;
  /** On the dry run, at most 50 by code; on a commit this is empty (a commit
   *  with clashes is a 409 instead). */
  clashes: PincodeClash[];
  /** The true total — `clashes` is capped at 50 rows. */
  clashCount: number;
  movedTechnicians: MovedTechnician[];
  trimmedTechnicians: TrimmedTechnician[];
  /**
   * Open invites that move or trim with the same rule — typed because the wire
   * carries it, not rendered yet (Task 08's mock has no invite row in the
   * preview; adding one is copy sign-off).
   */
  invitesChanged: {
    id: string;
    phone: string;
    change: "moved" | "trimmed";
    losing: string[];
  }[];
  restampedTickets: RestampedTickets;
  /** Held tickets in the changed codes — they KEEP their technician (F6). */
  assignedTicketsKept: number;
}

/* ── franchisee admins ───────────────────────────────────────────────────── */

/**
 * A franchisee_admin membership of one franchisee. `lastLoginAt` is "last
 * active" — a session refresh writes it too (index §6) — and null means never.
 *
 * `isLastActiveAdmin` is the server's opinion (owner ruling 2026-10-15, R3) of
 * whether deactivating this admin would be refused with 409
 * `FRANCHISEE_LAST_ADMIN`. Always false on the home franchisee, which is exempt.
 */
export interface FranchiseeAdmin {
  membershipId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  isLastActiveAdmin: boolean;
}

/** `POST /admins` and the reissue — the admin plus what happened to the email. */
export type CreatedFranchiseeAdmin = FranchiseeAdmin & EmailOutcome;