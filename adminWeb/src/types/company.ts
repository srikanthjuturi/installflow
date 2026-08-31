/**
 * Company (tenant) domain types — mirror the backend's `CompanyOut` and the
 * create/update request bodies exactly. The superadmin console is the only
 * surface that speaks these.
 */

import type { EmailOutcome } from "./user";

export interface Company {
  id: string;
  name: string;
  slug: string;
  /** Prefix on every code this company mints — `RGT` in `RGT-INST-0001`.
   *  Assigned at creation and immutable: tickets store the assembled string. */
  code: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  gstNumber: string;
  pan: string;
  gstCompanyStatus: string;
  /**
   * The whole street address in ONE field, newlines kept — the same shape a
   * vendor's has. It was line 1 + line 2 until the API folded them together;
   * the name stays `addressLine1` because that is the column.
   */
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  /** Email of the company's admin (first admin membership), or null. */
  adminEmail: string | null;
  /** Active membership count, present on detail responses. */
  userCount: number | null;
  createdAt: string;
}

/** Body for `POST /companies`. */
export interface CreateCompanyInput {
  /** Omit to let the server derive it from the name. */
  code?: string;
  name: string;
  email: string;
  phone?: string | null;
  adminName?: string | null;
  gstNumber: string;
  pan: string;
  gstCompanyStatus: string;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
}

/** `POST /companies` only — every other endpoint returns `Company`. */
export type CreatedCompany = Company & EmailOutcome;

/** Body for `PUT /companies/{id}` — every field optional. */
export type UpdateCompanyInput = Partial<
  Omit<CreateCompanyInput, "adminName">
>;
