/**
 * A vendor's own people.
 *
 * Deliberately not `CompanyUser`. That type describes the COMPANY's staff — it
 * carries a role, a manager and a territory, none of which a vendor's account
 * has — and it is served by `/users`, an endpoint a vendor cannot call at all.
 */

export interface VendorUser {
  /** The MEMBERSHIP id, which is what the routes take: removing somebody
   *  removes them from this vendor, not from the platform. */
  membershipId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  /** True for the account that IS the vendor. Listed so whoever is looking
   *  finds themselves, but it cannot be edited or removed from here. */
  isOwner: boolean;
  createdAt: string;
}

export interface CreateVendorUserInput {
  fullName: string;
  email: string;
  phone?: string | null;
  /** Told to them, and changed by them on the change-password screen. */
  password: string;
}

export interface UpdateVendorUserInput {
  fullName?: string;
  phone?: string | null;
  isActive?: boolean;
}
