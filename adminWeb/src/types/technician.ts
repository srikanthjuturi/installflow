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

  dailyJobCap: number;
  /** Jobs in flight today. Always 0 until the jobs slice exists. */
  bwUsed: number;
  rating: number | null;
  jobsCompleted: number;
  jobsCancelled: number;
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
  dailyJobCap: number;
  sentAt: string | null;
  registeredAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** One row of the Technicians screen. Discriminated on `registered`. */
export type TechnicianRow = Technician | TechnicianInvite;

export interface JobHistoryEntry {
  id: string;
  cat: string;
  date: string;
  outcome: "Closed" | "Cancelled";
}

/* ----------------------------------------------------------------- inputs */

export interface CreateTechnicianInput {
  fullName: string;
  phone: string;
  profileImageUrl?: string | null;
  regionId?: string | null;
  subcategoryIds: string[];
  pincodes: string[];
  dailyJobCap: number;
}

export interface UpdateTechnicianInput {
  id: string;
  fullName?: string;
  profileImageUrl?: string | null;
  regionId?: string;
  subcategoryIds?: string[];
  pincodes?: string[];
  dailyJobCap?: number;
  status?: TechnicianStatus;
}

export interface InviteTechnicianInput {
  phone: string;
  regionId?: string | null;
  dailyJobCap?: number;
}
