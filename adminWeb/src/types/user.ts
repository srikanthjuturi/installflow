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
  /** Territory: regions for a regional head, one region + pincodes for an AM. */
  regions: Region[];
  pincodes: string[];
  /** Ready-made summary: "All India" / "North, West" / "North · 3 pincodes". */
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
  /** Territory — required for a regional head (regions) and an area manager. */
  regionIds?: string[];
  pincodes?: string[];
}

/** Body for `PUT /users/{membershipId}`. Role is never changed here. */
export interface UpdateUserInput {
  fullName?: string | null;
  phone?: string | null;
  isActive?: boolean;
  managerId?: string | null;
  /** Omit to leave the territory alone; send a list to replace it. */
  regionIds?: string[];
  pincodes?: string[];
}

/** A role from `GET /roles` — the rank drives "who can assign whom". */
export interface RoleOption {
  key: string;
  label: string;
  rank: number;
}
