import { z } from "zod";
import { toE164 } from "@/utils/phone";
import type { FranchiseeInput, FranchiseeKind } from "@/types/franchisee";
import {
  KIND_OPTIONS,
  KIND_WORD_TO_WIRE,
  type KindWord,
} from "./franchiseeKind";

/**
 * The franchisee and the franchisee-admin forms.
 *
 * The forms hold the WORDS (Kind "Internal"/"External"; phones as typed) and
 * these files are where the wire shapes get decided at submit — the same
 * contract as technicianSchema. The phone is the one field that changes shape:
 * 10 digits as typed, E.164 to the API, `formatPhone` on the way back.
 */
const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;

export const FRANCHISEE_KINDS: readonly KindWord[] = KIND_OPTIONS;

const phoneField = z
  .string()
  .trim()
  .regex(PHONE_RE, "Enter a 10-digit mobile number")
  .transform(toE164);

export const franchiseeSchema = z.object({
  name: z.string().trim().min(2, "Enter a name of at least 2 characters"),
  kind: z.enum(FRANCHISEE_KINDS),
  contactName: z.string().trim().min(2, "Enter the contact's name"),
  contactPhone: phoneField,
  /** Optional everywhere. Empty clears it; that is what the API asks for. */
  contactEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
});

export type FranchiseeFormValues = z.infer<typeof franchiseeSchema>;

/** `POST /franchisees`'s body; the update omits what did not change. */
export function franchiseeToInput(
  values: FranchiseeFormValues,
  base?: { kind?: FranchiseeKind }
): FranchiseeInput {
  return {
    name: values.name,
    kind: KIND_WORD_TO_WIRE[values.kind as KindWord],
    contactName: values.contactName,
    contactPhone: values.contactPhone,
    contactEmail: values.contactEmail || null,
    ...base,
  };
}

/* ── the admin form ──────────────────────────────────────────────────────── */

export const adminSchema = z.object({
  fullName: z.string().trim().min(2, "Enter a name of at least 2 characters"),
  email: z.string().trim().email("Enter a valid email address"),
  // Mandatory for every console login, franchisee admins included — the only
  // way to reach somebody whose mailbox bounces (root AGENTS).
  phone: phoneField,
});

export type AdminFormValues = z.infer<typeof adminSchema>;