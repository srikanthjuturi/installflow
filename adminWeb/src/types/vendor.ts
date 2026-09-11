/**
 * Vendors — the companies that supply the products, and who to call about them.
 *
 * BOTH a record and an account. Every product model points at exactly one, and
 * carries one of its BRANDS — a vendor may sell several (Crestline Distributors
 * sells Meridian and Sunview). A vendor signs in to the portal at `/portal`,
 * where it raises tickets, manages its own users and asks for new brands.
 * `intakeChannels` decides which entry screens it gets.
 *
 * This replaced an earlier mock-only `Vendor` that modelled a ticket-INTAKE
 * source — intake channel, API credentials, lifetime ticket volume, "since"
 * year. Two of those four are now real: `intakeChannels` is stored, and
 * `ticketCount` is a genuine (currently zero) figure.
 *
 * Still absent, deliberately:
 *   API credentials  no endpoint for a vendor to push to and no key issuance,
 *                    so there is nothing to show. Returns with the API channel.
 *   "since"          `createdAt` records when the ROW was made, not when the
 *                    commercial relationship began. A "Since 2026" on every
 *                    vendor would be a worse lie than an absent column.
 */

import type { EmailOutcome } from "./user";

/** §4 of the requirement document. Mirrors INTAKE_CHANNELS in app/core/intake.py. */
export type IntakeChannel = "API" | "Excel" | "Manual";

/** `pending` | `approved` | `rejected` — a vendor-added brand waits for approval. */
export type BrandStatus = "pending" | "approved" | "rejected";

/** One of a vendor's brands — what is printed on the unit. */
export interface VendorBrand {
  id: string;
  name: string;
  /** Only an approved brand can be put on a product. Staff-added ones are
   *  approved at once; a vendor's own wait on Approvals. */
  approvalStatus: BrandStatus;
  /** Why it was refused, when it was. The vendor reads this. */
  rejectionReason: string | null;
  submittedAt: string | null;
  /** Live products carrying it — a brand with any cannot be removed. */
  productCount: number;
}

export interface Vendor {
  id: string;
  /** The company's trading name. Not a brand any more — see `brands`. */
  name: string;
  gstNumber: string;
  /**
   * The entity's PAN — the ten characters inside its own GSTIN.
   *
   * Null only where nobody has filled it in. It is derivable for every vendor,
   * so it never means "this one has none", the way a null `cin` does.
   */
  pan: string | null;
  /** Only an MCA-registered company has one; a proprietorship does not. */
  cin: string | null;
  /**
   * The registration's standing at the GST portal — "Active", "Cancelled".
   *
   * Null means the portal has never been asked, which is every vendor until the
   * GSTIN lookup ships. Render it as nothing; never as "Active".
   */
  gstCompanyStatus: string | null;
  contactPerson: string;
  /** E.164 — the API normalises whatever is typed. */
  phone: string;
  /** One free-text box; city, state and pincode are their own fields. */
  address: string;
  city: string;
  state: string;
  pincode: string;
  /** How this vendor's tickets reach us. One or more, in the order picked. */
  intakeChannels: IntakeChannel[];
  isActive: boolean;
  /** Whether this vendor's portal offers the Google address search. */
  addressSearchEnabled: boolean;
  /**
   * Whether a technician's live site photo is location-gated on this vendor's
   * jobs.
   *
   * Not the same question as the switch above. That one decides WHICH rule the
   * server applies — distance if the address was picked off the map, pincode if
   * it was typed. This one decides whether either is enforced at all; off means
   * the photo is still geo-tagged and stored, and simply never refused.
   */
  locationCheckEnabled: boolean;
  /**
   * Address searches this vendor and their staff have run, ever. A real COUNT
   * over one row per billed Google session.
   *
   * LIFETIME, and independent of the switch — turning a vendor off does not
   * erase what they already spent, so a non-zero figure beside an Off vendor
   * is correct rather than a bug.
   */
  addressSearchCount: number;
  /** Live product models this vendor supplies. A real COUNT, not seed data. */
  modelCount: number;
  /** Every live brand, approved first then waiting, A–Z within each. */
  brands: VendorBrand[];
  /** The address this vendor signs in with. */
  loginEmail: string | null;
  /**
   * Tickets received from this vendor. Always 0 until the jobs slice exists —
   * the true figure, since nothing can receive a ticket yet, not a placeholder.
   */
  ticketCount: number;
  createdAt: string;
}

/** One row of the intake-channel catalogue from `GET /vendors/channels`. */
export interface IntakeChannelOption {
  value: IntakeChannel;
  description: string;
  available: boolean;
  /** Why not, when `available` is false. */
  unavailableReason: string | null;
}

/** Just enough to draw the product form's Vendor and Brand pickers. */
export interface VendorOption {
  id: string;
  name: string;
  /** APPROVED brands only — the ones a product may carry. */
  brands: { id: string; name: string }[];
}

/** `POST /vendors` and the reissue only — elsewhere it is a plain `Vendor`. */
export type CreatedVendor = Vendor & EmailOutcome;

export interface CreateVendorInput {
  /** Required: only a vendor raises a ticket, so one without a login is a
   *  brand nobody could ever raise a ticket against. */
  loginEmail: string;
  name: string;
  gstNumber: string;
  pan?: string | null;
  gstCompanyStatus?: string | null;
  cin?: string | null;
  contactPerson: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  intakeChannels: IntakeChannel[];
  isActive: boolean;
  addressSearchEnabled: boolean;
  locationCheckEnabled: boolean;
  /** The brands it sells, approved as written. Empty means it sells under its
   *  own name — the server then gives it one brand called what it is called. */
  brands: string[];
}

export interface UpdateVendorInput {
  id: string;
  name?: string;
  gstNumber?: string;
  /** Explicit null clears these three; omitting a key leaves it alone. */
  pan?: string | null;
  gstCompanyStatus?: string | null;
  cin?: string | null;
  contactPerson?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  /** Sent whole — omit to leave the channels alone; an empty array is refused. */
  intakeChannels?: IntakeChannel[];
  isActive?: boolean;
  addressSearchEnabled?: boolean;
  locationCheckEnabled?: boolean;
  /**
   * The APPROVED brands, sent whole: a row with an `id` is kept (renamed if the
   * name changed), one without is new, and an approved brand left out is
   * removed — a 409 while a live product carries it. A vendor's waiting brands
   * are decided on Approvals; leaving them out does nothing to them.
   */
  brands?: { id?: string; name: string }[];
}
