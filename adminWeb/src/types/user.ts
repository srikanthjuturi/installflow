/**
 * Company user (membership) domain types — mirror the backend's `UserOut` and
 * the create/update request bodies. Used by the tenant-scoped users screen.
 */

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
}

/** Body for `PUT /users/{membershipId}`. Role is never changed here. */
export interface UpdateUserInput {
  fullName?: string | null;
  phone?: string | null;
  isActive?: boolean;
  managerId?: string | null;
}

/** A role from `GET /roles` — the rank drives "who can assign whom". */
export interface RoleOption {
  key: string;
  label: string;
  rank: number;
}
