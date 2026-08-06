import { z } from "zod";

/**
 * A technician is offered a job on three things at once: the category, the
 * pincode and free bandwidth. All three are therefore required at onboarding —
 * a technician missing any one of them is never notified about anything.
 */

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
  cats: z.array(z.string()).min(1, "Select at least one category"),
  pincodes: z
    .string()
    .trim()
    .refine((v) => parsePincodes(v).length > 0, "Enter at least one pincode")
    .refine(
      (v) => parsePincodes(v).every((p) => /^\d{6}$/.test(p)),
      "Every pincode must be 6 digits"
    ),
  bwTotal: z.string().min(1, "Select a daily job cap"),
  /** Optional cropped profile photo, carried as a data URL. */
  photo: z.string().optional(),
});

export type TechnicianFormValues = z.infer<typeof technicianSchema>;
