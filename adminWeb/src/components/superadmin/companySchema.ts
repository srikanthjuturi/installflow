import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

/**
 * Company form schema (create + edit).
 *
 * GSTIN / PAN / PIN formats are validated client-side for fast feedback; the
 * backend re-validates and is the authority. Patterns are case-insensitive —
 * the value is uppercased on submit (and again server-side).
 */

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
export const PINCODE_RE = /^[0-9]{6}$/;

/**
 * Every field is a string (empty = "not provided" for the optional ones), so
 * the inferred type matches the all-string form values RHF holds.
 *
 * Create and edit validate identically now that neither takes a password — the
 * server mints a temporary one for the admin and emails it to the company
 * address. One schema, no mode.
 */
export function companySchema() {
  return z
    .object({
      name: z.string().trim().min(1, "Company name is required").max(255),
      email: z.string().trim().email("Enter a valid email"),
      phone: z.string().trim().max(32),
      gstNumber: z
        .string()
        .trim()
        .regex(GSTIN_RE, "Enter a valid 15-character GSTIN"),
      pan: z.string().trim().regex(PAN_RE, "Enter a valid 10-character PAN"),
      gstCompanyStatus: z
        .string()
        .trim()
        .min(1, "GST status is required")
        .max(64),
      addressLine1: z.string().trim().min(1, "Address is required").max(255),
      addressLine2: z.string().trim().max(255),
      city: z.string().trim().min(1, "City is required").max(120),
      state: z.string().trim().min(1, "State is required").max(120),
      pincode: z.string().trim().regex(PINCODE_RE, "Enter a 6-digit PIN code"),
      adminName: z.string().trim().max(255),
    });
}

export type CompanyFormValues = z.infer<ReturnType<typeof companySchema>>;

export const companyResolver = () => zodResolver(companySchema());

/** Blank create form. */
export const EMPTY_COMPANY_FORM: CompanyFormValues = {
  name: "",
  email: "",
  phone: "",
  gstNumber: "",
  pan: "",
  gstCompanyStatus: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  pincode: "",
  adminName: "",
};
