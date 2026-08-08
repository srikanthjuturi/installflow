/**
 * Company (tenant) domain types — mirror the backend's `CompanyOut` and the
 * create/update request bodies exactly. The superadmin console is the only
 * surface that speaks these.
 */

export interface Company {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  gstNumber: string;
  pan: string;
  gstCompanyStatus: string;
  addressLine1: string;
  addressLine2: string | null;
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
  name: string;
  email: string;
  phone?: string | null;
  password: string;
  adminName?: string | null;
  gstNumber: string;
  pan: string;
  gstCompanyStatus: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  pincode: string;
}

/** Body for `PUT /companies/{id}` — every field optional. */
export type UpdateCompanyInput = Partial<
  Omit<CreateCompanyInput, "password" | "adminName">
>;
