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
 * the inferred type matches the all-string form values RHF holds. `password`
 * is only required in create mode — enforced via `superRefine` on the captured
 * mode.
 */
export function companySchema(mode: "create" | "edit") {
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
      password: z.string().max(128),
    })
    .superRefine((val, ctx) => {
      if (mode === "create" && val.password.trim().length < 8) {
        ctx.addIssue({
          code: "custom",
          path: ["password"],
          message: "At least 8 characters",
        });
      }
    });
}

export type CompanyFormValues = z.infer<ReturnType<typeof companySchema>>;

export const companyResolver = (mode: "create" | "edit") =>
  zodResolver(companySchema(mode));

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
  password: "",
};
