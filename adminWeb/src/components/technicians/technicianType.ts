/**
 * The technician type's presentation vocabulary, in its own module because a
 * file that exports a component may export nothing else (fast refresh) — and
 * the table, the profile facts and both forms read the WORDS while the wire
 * takes the lowercase, converted per call site.
 */
import type { TechnicianType } from "@/types/technician";

/** The two types, as the FORM holds them. */
export const TYPE_OPTIONS = ["Freelancer", "Employee"] as const;
export type TypeWord = (typeof TYPE_OPTIONS)[number];

export const TYPE_WORD_TO_WIRE = {
  Freelancer: "freelancer",
  Employee: "employee",
} as const satisfies Record<TypeWord, TechnicianType>;

export function wireTypeToWord(type: TechnicianType): TypeWord {
  return type === "employee" ? "Employee" : "Freelancer";
}