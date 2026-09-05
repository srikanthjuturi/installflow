/**
 * Company user (membership) domain types — mirror the backend's `UserOut` and
 * the create/update request bodies. Used by the tenant-scoped users screen.
 */

/** A region of India. Global reference data from `GET /regions`. */
export interface Region {
  id: string;
  code: string;
  name: string;
}

/** A state a member covers. Area managers only. */
export interface MemberState {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
}

export interface CompanyUser {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  roleLabel: string;
  profileImageUrl: string | null;
  isActive: boolean;
  managerId: string | null;
  /** Who appointed this member — `memberships.created_by`. NOT `managerId`,
   *  which is the reporting line and may point elsewhere. Null on a
   *  system-seeded row. */
  appointedById: string | null;
  appointedBy: string | null;
  /** Territory: regions for a regional head, states for an area manager. An
   *  AM's regions are derived from his states and returned here too. */
  regions: Region[];
  /** An area manager's states. He covers every pincode inside them, which is
   *  thousands — that list is never sent, it is searched via `/geo/pincodes`. */
  states: MemberState[];
  /** Ready-made summary: "All India" / "North, West" / "South · Telangana". */
  scopeLabel: string;
  createdAt: string;
}

/**
 * What happened to an account's temporary-password email.
 *
 * `sent` — Azure accepted it. Not proof it arrived; there is no delivery
 * webhook, so a later bounce is invisible.
 * `failed` — refused, timed out, unconfigured, or blocked by the dev allowlist.
 * `skipped` — no password was issued, because the email already belonged to an
 * identity that keeps its own. A success, not a failure.
 */
export type EmailStatus = "sent" | "failed" | "skipped";

/** The three fields every create/reissue response carries. */
export interface EmailOutcome {
  emailStatus: EmailStatus;
  /** Why it did not go out. Null unless `emailStatus === "failed"`. */
  emailError: string | null;
  /**
   * Returned ONLY when the email failed, and it is the only copy that will ever
   * exist — staff have no password reset, so if this is lost the account can be
   * recovered only by reissuing. Never persist or log it.
   */
  temporaryPassword: string | null;
}

/** `POST /users` and the reissue only — every other endpoint returns `CompanyUser`. */
export type CreatedCompanyUser = CompanyUser & EmailOutcome;

/** Body for `POST /users`. No password: the server mints and emails one. */
export interface CreateUserInput {
  email: string;
  role: string;
  fullName?: string | null;
  /** Required — the server refuses a create without one. */
  phone: string;
  managerId?: string | null;
  /** Territory. A regional head sends `regionIds`; an area manager sends
   *  `stateIds` ONLY — his region is derived from them server-side. */
  regionIds?: string[];
  stateIds?: string[];
}

/** Body for `PUT /users/{membershipId}`. Role is never changed here. */
export interface UpdateUserInput {
  fullName?: string | null;
  phone?: string | null;
  isActive?: boolean;
  managerId?: string | null;
  /** Omit to leave the territory alone; send a list to replace it. */
  regionIds?: string[];
  stateIds?: string[];
}

/** A role from `GET /roles` — the rank drives "who can assign whom". */
export interface RoleOption {
  key: string;
  label: string;
  rank: number;
}
