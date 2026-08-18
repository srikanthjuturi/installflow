/**
 * Vendors — the brands the company stocks, and who to call about them.
 *
 * A record, not an account: nobody signs in as a vendor. Every product model
 * points at exactly one, which is how a model gets its brand.
 *
 * This replaced an earlier mock-only `Vendor` that modelled a ticket-INTAKE
 * source — intake channel, API credentials, lifetime ticket volume, "since"
 * year. Same companies, different facts, and none of those four has a backend
 * source yet. They come back with the jobs slice that can supply them; until
 * then the screen shows what is real (hard rule: do not fake a number that has
 * a real source).
 */

export interface Vendor {
  id: string;
  /** The trading name, and the label the brand picker shows. */
  name: string;
  gstNumber: string;
  /** Only an MCA-registered company has one; a proprietorship does not. */
  cin: string | null;
  contactPerson: string;
  /** E.164 — the API normalises whatever is typed. */
  phone: string;
  /** One free-text box; city, state and pincode are their own fields. */
  address: string;
  city: string;
  state: string;
  pincode: string;
  isActive: boolean;
  /** Live product models carrying this brand. A real COUNT, not seed data. */
  modelCount: number;
  createdAt: string;
}

/** Just enough to draw the brand picker on the product model form. */
export interface VendorOption {
  id: string;
  name: string;
}

export interface CreateVendorInput {
  name: string;
  gstNumber: string;
  cin?: string | null;
  contactPerson: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  isActive: boolean;
}

export interface UpdateVendorInput {
  id: string;
  name?: string;
  gstNumber?: string;
  /** Explicit null clears it — the one field on a vendor that can be cleared. */
  cin?: string | null;
  contactPerson?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  isActive?: boolean;
}
