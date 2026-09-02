/**
 * Technicians, as the API returns them.
 *
 * The list is a union: a registered technician and a phone number that has only
 * been invited are the same person at two lifecycle stages, and the screen shows
 * both. Narrow on `registered` before touching anything an invite cannot know.
 */

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
   * All three are null until the jobs slice measures them. Null means "not
   * measured", which is not the same claim as 0 — render it as an em dash.
   */
  jobsCompleted: number | null;
  jobsCancelled: number | null;
  onTimePct: number | null;

  onboarding: TechnicianOnboarding;
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
  createdAt: string;
}

/** One row of the Technicians screen. Discriminated on `registered`. */
export type TechnicianRow = Technician | TechnicianInvite;

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
  status?: TechnicianStatus;
}

export interface InviteTechnicianInput {
  /** The coverage the manager assigns. Required — the app only displays it. */
  pincodes: string[];
  phone: string;
  regionId?: string | null;
  dailyJobCap?: number;
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
