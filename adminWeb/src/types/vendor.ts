/**
 * Vendors — the brands the company stocks, and who to call about them.
 *
 * BOTH a record and an account. Every product model points at exactly one,
 * which is how a model gets its brand; and a vendor signs in to the portal at
 * `/portal`, where it raises tickets against itself and manages its own users.
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

export interface Vendor {
  id: string;
  /** The trading name, and the label the brand picker shows. */
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
  /** Live product models carrying this brand. A real COUNT, not seed data. */
  modelCount: number;
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

/** Just enough to draw the brand picker on the product model form. */
export interface VendorOption {
  id: string;
  name: string;
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
}
