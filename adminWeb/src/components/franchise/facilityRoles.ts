import { z } from "zod";
import { toE164 } from "@/utils/phone";
import type { BackendRole } from "@/types/api";
import type { FacilityRole } from "@/types/parts";

/**
 * Who may add and manage which facility role — Task 13 §5.7 / §4.8. Pure.
 *
 * Mirrors `core.spare_parts.can_create_facility_role`: a franchisee admin may
 * make both roles, a facility admin only operators, and the company's Admin and
 * National Head both (for the HOME franchisee only, through the staff door).
 * Presentation only (hard rule 8) — the server holds the real rule and answers
 * 403 "You can only add roles below your own".
 */

/** The words the role cards show; the wire value is `FacilityRole`. */
export const FACILITY_ROLE_WORDS = ["Facility Admin", "Facility Operator"] as const;
export type FacilityRoleWord = (typeof FACILITY_ROLE_WORDS)[number];

export const ROLE_WORD_TO_WIRE: Record<FacilityRoleWord, FacilityRole> = {
  "Facility Admin": "facility_admin",
  "Facility Operator": "facility_operator",
};

export const ROLE_WIRE_TO_WORD: Record<FacilityRole, FacilityRoleWord> = {
  facility_admin: "Facility Admin",
  facility_operator: "Facility Operator",
};

/** One sentence per card — travels with the option it describes. */
export const ROLE_DESCRIPTION: Record<FacilityRoleWord, string> = {
  "Facility Admin": "also adds and removes operators",
  "Facility Operator": "approves, issues and logs returns",
};

/** The facility roles this viewer may CREATE, in card order. */
export function rolesViewerCanAdd(viewer: BackendRole | undefined): FacilityRole[] {
  switch (viewer) {
    case "franchisee_admin":
    case "admin":
    case "national_head":
      return ["facility_admin", "facility_operator"];
    case "facility_admin":
      return ["facility_operator"];
    default:
      return [];
  }
}

/**
 * May this viewer act (reissue, deactivate, activate) on a row of `target`'s
 * role? A facility admin only on operators; never on yourself (`isSelf`).
 */
export function canManageFacilityUser(
  viewer: BackendRole | undefined,
  target: FacilityRole,
  isSelf: boolean
): boolean {
  return !isSelf && rolesViewerCanAdd(viewer).includes(target);
}

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

/** The add form. The phone is mandatory (the console-login rule) and leaves as E.164. */
export const facilityUserSchema = z.object({
  fullName: z.string().trim().min(2, "Enter a name of at least 2 characters"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .regex(PHONE_RE, "Enter a 10-digit mobile number")
    .transform(toE164),
  role: z.enum(FACILITY_ROLE_WORDS, "Choose a role"),
});

export type FacilityUserFormValues = z.infer<typeof facilityUserSchema>;
