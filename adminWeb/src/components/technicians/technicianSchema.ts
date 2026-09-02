import { z } from "zod";
import type { TechnicianStatus } from "@/types/technician";

/**
 * A technician is offered a job on three things at once: the subcategory, the
 * pincode and free bandwidth. The first two are required at onboarding — a
 * technician with neither a category nor a pincode is never notified about
 * anything, and nothing can supply them on their behalf.
 *
 * The daily job cap is NOT asked for when ADDING. A number invented at intake is
 * one nobody has a basis for yet, so a new technician starts with no limit and
 * sets their own in the app (Profile -> Availability & bandwidth). The EDIT form
 * shows it, because by then somebody has worked days and a manager has a reason
 * to change it. "No limit" is null, not a number — which is why the box takes a
 * string and an empty one means no limit rather than zero.
 *
 * Certification is at the SUBCATEGORY level (Television, Air Conditioner), not
 * the parent category (Electric) — a TV specialist should not be offered air
 * conditioners because both hang off the same grouping.
 */

export const PINCODE_RE = /^\d{6}$/;

/**
 * The three administrative states, in the order the list filter offers them.
 * `satisfies` keeps this honest if `TechnicianStatus` ever changes.
 */
export const TECHNICIAN_STATUSES = [
  "active",
  "inactive",
  "suspended",
] as const satisfies readonly TechnicianStatus[];

/**
 * One word per state, so the pill on the roster and the radio card in the edit
 * form can never say different things about the same technician.
 *
 * Here rather than beside `TechStatusPill`, which is a component file: exporting
 * a constant from one breaks fast refresh, and this is copy either way. Named
 * with the `TECH_` prefix because `onboarding.ts` exports a `STATUS_LABEL` for
 * the INVITE lifecycle and the two get imported into the same module.
 */
export const TECH_STATUS_LABEL: Record<TechnicianStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
};

/** Accepts commas, spaces or newlines so a pasted list works as typed. */
export function parsePincodes(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}

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
  /** Optional profile photo — the URL the crop was uploaded to, never inline
   *  image data, which the API refuses. */
  photo: z
    .string()
    .refine(
      (v) => /^https?:\/\//i.test(v),
      "That photo was not stored. Upload it again."
    )
    .optional(),
  /**
   * EDIT ONLY — the add form never renders it and submits nothing for it.
   *
   * A string, not a number: the box is legitimately EMPTY, and that empty means
   * "no limit" rather than "zero jobs a day". A numeric field would have to
   * spell that difference as `NaN`, and RHF hands an empty number input back as
   * exactly that. The floor is 1 for the same reason — a cap of 0 means "never
   * offer me work", which is what going offline says.
   */
  dailyJobCap: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (/^\d+$/.test(v) && Number(v) >= 1),
      "Enter 1 or more, or leave it blank for no limit"
    ),
  /** EDIT ONLY. Only an Active technician is offered work — see the dialog. */
  status: z.enum(TECHNICIAN_STATUSES),
});

export type TechnicianFormValues = z.infer<typeof technicianSchema>;
