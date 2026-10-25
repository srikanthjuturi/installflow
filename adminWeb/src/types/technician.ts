/**
 * Technicians, as the API returns them.
 *
 * The list is a union: a registered technician and a phone number that has only
 * been invited are the same person at two lifecycle stages, and the screen shows
 * both. Narrow on `registered` before touching anything an invite cannot know.
 */

import type { BaseSource, BaseLocation } from "./allowances";

export type OnboardingMode = "invite" | "direct";
export type RegisteredBy = "self" | "manager";
export type TechnicianStatus = "active" | "inactive" | "suspended";

/**
 * Invite lifecycle. `sent` means WhatsApp accepted the message — not that it
 * arrived; knowing the difference needs a delivery webhook, a later phase.
 */
export type InviteStatus =
  | "pending"
  | "sent"
  | "failed"
  | "registered"
  | "cancelled"
  | "expired";

/**
 * How they are paid — the second fact Task 05 puts on every technician row
 * (T1). Lowercase on the wire; the forms hold the WORD ("Freelancer"/"Employee")
 * and convert at submit, per ChoiceCards' rule.
 *
 * An employee gets no per-job payout and can't redeem earnings; allowances and
 * penalties still apply. A change applies to the jobs accepted AFTER it, so it
 * is never backdated — the server refuses one that would rewrite a balance.
 */
export type TechnicianType = "employee" | "freelancer";

export const TECHNICIAN_TYPES = ["employee", "freelancer"] as const satisfies
  readonly TechnicianType[];

export interface SubcategoryRef {
  id: string;
  name: string;
  categoryName: string;
}

/** Who appointed them, who filled the record in, and when. */
export interface TechnicianOnboarding {
  mode: OnboardingMode;
  registeredBy: RegisteredBy;
  appointedByName: string | null;
  appointedByEmail: string | null;
  /** The raw role key, e.g. `national_head`. */
  appointedByRole: string | null;
  /** Display form, e.g. "National Head". */
  appointedByRoleLabel: string | null;
  appointedAt: string;
  registeredAt: string;
}

export interface Technician {
  registered: true;
  id: string;
  membershipId: string;
  userId: string;
  /** Display id, e.g. TCH-4021. */
  code: string;
  name: string;
  phone: string;
  profileImageUrl: string | null;
  isActive: boolean;
  status: TechnicianStatus;

  regionId: string;
  regionName: string;
  subcategories: SubcategoryRef[];
  pincodes: string[];

  /** Null = no limit. */
  dailyJobCap: number | null;
  /**
   * Where their earnings are paid — a UPI VPA, `name@bank`.
   *
   * Null means they have not given one, which is the normal state for a new
   * technician: neither onboarding mode requires it. Render "—". It costs only
   * the ability to be PAID; the ledger credits them either way.
   */
  upiId: string | null;
  /** The name on that UPI account, when known — what a payer's app shows. */
  upiName: string | null;
  /** They asked for a new UPI ID and nobody has decided — see `UpiChange`. */
  upiChangePending: boolean;
  /** Jobs held for TODAY, by slot date — the rule the daily cap is enforced on. */
  bwUsed: number;
  /** The technician's own decision: are they taking work at all. */
  acceptingWork: boolean;
  /**
   * Intent AND reachability, derived server-side.
   *
   * Deliberately not the same as `acceptingWork`: somebody can be willing to
   * work and have a phone that has not been reachable for an hour. A manager
   * assigning by hand needs the second question answered, which is why this is
   * a console field and the app's own switch shows intent instead.
   */
  online: boolean;
  rating: number | null;
  /**
   * All three are null until there is something to measure — a first closure,
   * a first cancellation. Null means "not measured", which is not the same
   * claim as 0 — render it as an em dash.
   */
  jobsCompleted: number | null;
  jobsCancelled: number | null;
  /**
   * Share of closed jobs where the live proof photo was taken no later than
   * 30 minutes after the slot closed. Worked out by the server on every
   * closure (`refresh_technician_stats` argues the rules); null until a closed
   * job qualifies.
   */
  onTimePct: number | null;

  onboarding: TechnicianOnboarding;

  /* ── Task 05 fields: who the row belongs to, how they are paid ─────────── */

  franchiseeId: string;
  franchiseeName: string;
  /** True on the home franchisee — the catch-all every unclaimed pincode is. */
  franchiseeIsHome: boolean;
  technicianType: TechnicianType;
  /**
   * From the server (`franchise_scope.can_manage_technician` for the CALLER),
   * never recomputed in the browser (F8). False hides every row write — Edit,
   * Remove, Send app link, UPI decides — because the franchisee admin manages
   * this one; a false row also nulls its money fields server-side.
   */
  canManage: boolean;

  /* ── Task 10 (R9): the base at a glance ───────────────────────────────────
     On every row and the detail. All three are null together when there is no
     base — which is "not set", never "₹0". The COORDINATES are not here: a
     list must not hand them to every row-reader, so they ride only the detail
     (`baseLocation`) and only for a caller who can manage the technician. */
  baseSource: BaseSource | null;
  baseSetAt: string | null;
  baseSetBySelf: boolean | null;
  /**
   * The base in full — the detail read only, and non-null only for a caller
   * who can manage this technician. A staff viewer of a non-home technician
   * gets null here and the three fields above (W13).
   */
  baseLocation?: BaseLocation | null;

  createdAt: string;
}

/** A phone number with an invite against it. Nothing else is known yet. */
export interface TechnicianInvite {
  registered: false;
  id: string;
  phone: string;
  status: InviteStatus;
  regionId: string;
  regionName: string;
  invitedByName: string | null;
  invitedByEmail: string | null;
  /** The deep link. Shown so a manager can send it by hand when WhatsApp fails. */
  inviteLink: string;
  /** Why WhatsApp refused, when it did. */
  failureReason: string | null;
  /** Null = no limit. */
  dailyJobCap: number | null;
  sentAt: string | null;
  registeredAt: string | null;
  expiresAt: string;

  /* ── Task 05 fields, same as a registered row ──────────────────────────── */

  franchiseeId: string;
  franchiseeName: string;
  franchiseeIsHome: boolean;
  technicianType: TechnicianType;
  canManage: boolean;

  createdAt: string;
}

/** One row of the Technicians screen. Discriminated on `registered`. */
export type TechnicianRow = Technician | TechnicianInvite;

/**
 * What happened to the WhatsApp telling a technician where the app is — on
 * add, and on "Send app link".
 *
 * Reported, never stored: the technician's record is complete without it, so
 * unlike an invite there is no row status to show later. The toast is the
 * whole of it.
 */
export interface AppLinkOutcome {
  /** `sent` is Meta ACCEPTING it, not delivery — the same caveat as an invite. */
  appLinkStatus: "sent" | "failed";
  /** Meta's reason, when it refused. */
  appLinkError: string | null;
  /** The link, to hand over another way when the send failed. The same for
   *  every technician — it names no account. */
  appLink: string;
}

/** `POST /technicians`: the new technician, and whether the app link went. */
export type CreatedTechnician = Technician & AppLinkOutcome;

/* ----------------------------------------------------------------- inputs */

export interface CreateTechnicianInput {
  fullName: string;
  phone: string;
  profileImageUrl?: string | null;
  regionId?: string | null;
  subcategoryIds: string[];
  pincodes: string[];
  /** Omit to take the API's own default, exactly as an invite does. */
  dailyJobCap?: number;
  /** Optional — a manager often does not have it. Null or omitted means none. */
  upiId?: string | null;
  /** The name on that account. Optional even with a UPI ID. */
  upiName?: string | null;
  /** Omitted takes the API's default, freelancer. Staff creates always land on
   *  the HOME franchisee; a 422 `PINCODE_OUTSIDE_FRANCHISEE` names the codes
   *  another franchisee owns. */
  technicianType?: TechnicianType;
}

export interface UpdateTechnicianInput {
  id: string;
  fullName?: string;
  profileImageUrl?: string | null;
  regionId?: string;
  subcategoryIds?: string[];
  pincodes?: string[];
  /**
   * Null is a real value — it means NO LIMIT — so this is nullable rather than
   * merely optional. Omitted leaves the cap alone; `null` clears it. The API
   * makes the same distinction with `model_fields_set`, and typing it as
   * `number` alone made the cap one-way: settable but never clearable.
   */
  dailyJobCap?: number | null;
  /** Nullable for the same reason as the cap: `null` REMOVES a payout account
   *  that was typed wrong, which omitting it could never do. A manager changes
   *  it with no code — they are the check a technician's own change needs. */
  upiId?: string | null;
  upiName?: string | null;
  status?: TechnicianStatus;
  /**
   * Omitted leaves the type alone. The server refuses a change that would
   * strand a balance or open jobs — the refusal's message names the reason.
   */
  technicianType?: TechnicianType;
}

/**
 * A technician asking for their UPI ID to be changed.
 *
 * They add one themselves, proved by a WhatsApp code; after that a change is a
 * request a manager decides with no code. The bell goes to the Area Manager
 * for their area, else the Regional Head, else a National Head, else an Admin —
 * but anybody who can edit the technician may decide it.
 */
export interface UpiChange {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  oldUpiId: string;
  oldUpiName: string | null;
  newUpiId: string;
  newUpiName: string;
  reviewerRole: string;
  reviewerLabel: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
}

export interface InviteTechnicianInput {
  /** The coverage the manager assigns. Required — the app only displays it. */
  pincodes: string[];
  phone: string;
  regionId?: string | null;
  dailyJobCap?: number;
  /** Omitted takes the API's default, freelancer. */
  technicianType?: TechnicianType;
}

/** One district of a state, and how many technicians work in it. */
export interface DistrictTechnicianCount {
  districtId: string;
  name: string;
  technicianCount: number;
  /** The district's pincodes, so a zero reads as "nobody covers these 41". */
  pincodeCount: number;
}

/**
 * Technicians per district for one state.
 *
 * `totalTechnicians` is NOT the sum of the districts, and nothing may present
 * it as if it were: a pincode can sit in several districts at once, so a
 * technician covering one is counted in each — correctly. The total is counted
 * once over the state.
 *
 * `withoutDistrict` is the opposite case: a pincode can have no district at
 * all, and anybody whose coverage in this state is only such codes appears in
 * no column. Reported rather than dropped.
 */
export interface DistrictBreakdown {
  districts: DistrictTechnicianCount[];
  totalTechnicians: number;
  withoutDistrict: number;
}

/* ── Task 17: moving a technician to another franchisee ─────────────────────
   Mirror `api/app/features/technicians/schemas.py` (TechnicianTransfer*). The
   server wrote every sentence and every number; the console renders them. */

/** `kept` — what the technician already covers inside the target's area;
 *  `supplied` — the pincodes the caller sent instead. */
export type TransferCoverageSource = "kept" | "supplied";

export interface TransferCoverage {
  source: TransferCoverageSource;
  kept: string[];
  trimmed: string[];
  added: string[];
  /** What the coverage becomes — sorted, and empty only alongside a blocker. */
  after: string[];
  keptCount: number;
  trimmedCount: number;
  addedCount: number;
  regionBefore: string | null;
  regionAfter: string | null;
  regionChanged: boolean;
}

/**
 * One thing standing in the way. `code` is null for the code-less 409s
 * ("already works for…", "Activate … first", two regions) — the sentence is the
 * whole answer. `message` is shown exactly as sent.
 */
export interface TransferBlocker {
  code: string | null;
  message: string;
  openJobs?: number | null;
  redeemablePaise?: number | null;
  redemptionCode?: string | null;
}

/** One recorded move — a row of the profile's history, newest first. */
export interface TechnicianTransfer {
  id: string;
  at: string;
  technicianId: string;
  fromFranchiseeId: string;
  fromFranchiseeName: string;
  toFranchiseeId: string;
  toFranchiseeName: string;
  technicianType: TechnicianType;
  reason: string;
  byUserId: string;
  byName: string;
  kept: string[];
  trimmed: string[];
  added: string[];
}

/** The reply to both the preview (`dryRun: true`, `transfer: null`) and the move. */
export interface TechnicianTransferResult {
  dryRun: boolean;
  technicianId: string;
  technicianCode: string;
  technicianName: string;
  technicianType: TechnicianType;
  fromFranchiseeId: string;
  fromFranchiseeName: string;
  fromFranchiseeIsHome: boolean;
  toFranchiseeId: string;
  toFranchiseeName: string;
  toFranchiseeIsHome: boolean;
  coverage: TransferCoverage;
  blockers: TransferBlocker[];
  warnings: string[];
  /** No blockers. The preview's whole answer; always true on a move. */
  canTransfer: boolean;
  transfer: TechnicianTransfer | null;
}

/**
 * The body of `POST /technicians/{id}/transfer`. `reason` is optional on a
 * preview and needs 5+ characters on the move. **Omit `pincodes`** to keep what
 * the technician covers inside the target's area; sending it REPLACES coverage.
 */
export interface TechnicianTransferInput {
  franchiseeId: string;
  reason?: string;
  pincodes?: string[];
}
