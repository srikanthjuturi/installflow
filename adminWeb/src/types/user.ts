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

/** Body for `POST /users`. */
export interface CreateUserInput {
  email: string;
  role: string;
  fullName?: string | null;
  phone?: string | null;
  /** Temporary password for a brand-new identity (ignored if the email exists). */
  password?: string | null;
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
