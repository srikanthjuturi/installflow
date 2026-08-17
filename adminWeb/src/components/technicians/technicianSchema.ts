import { z } from "zod";

/**
 * A technician is offered a job on three things at once: the subcategory, the
 * pincode and free bandwidth. All three are therefore required at onboarding —
 * a technician missing any one of them is never notified about anything.
 *
 * Certification is at the SUBCATEGORY level (Television, Air Conditioner), not
 * the parent category (Electric) — a TV specialist should not be offered air
 * conditioners because both hang off the same grouping.
 */

export const PINCODE_RE = /^\d{6}$/;

/** Accepts commas, spaces or newlines so a pasted list works as typed. */
export function parsePincodes(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}

/** Plain jobs-per-day cap. Not weighted by job type — that stays an open decision. */
export const BANDWIDTH_OPTIONS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1)
);

export const technicianSchema = z.object({
  name: z.string().trim().min(2, "Technician name is required"),
  phone: z
    .string()
    .trim()
    .regex(
      /^(\+91[\s-]?)?[6-9]\d{9}$/,
      "Enter a valid 10-digit Indian mobile number"
    ),
  regionId: z.string().min(1, "Select a region"),
  /** Subcategory ids, not names — a rename must not orphan a certification. */
  subcategoryIds: z.array(z.string()).min(1, "Select at least one category"),
  pincodes: z
    .array(z.string())
    .min(1, "Add at least one pincode")
    .refine(
      (v) => v.every((p) => PINCODE_RE.test(p)),
      "Every pincode must be 6 digits"
    ),
  bwTotal: z.string().min(1, "Select a daily job cap"),
  /** Optional profile photo — the URL the crop was uploaded to, never inline
   *  image data, which the API refuses. */
  photo: z
    .string()
    .refine(
      (v) => /^https?:\/\//i.test(v),
      "That photo was not stored. Upload it again."
    )
    .optional(),
});

export type TechnicianFormValues = z.infer<typeof technicianSchema>;
