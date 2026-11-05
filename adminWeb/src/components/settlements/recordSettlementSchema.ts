import { z } from "zod";
import { SETTLEMENT_REASONS } from "@/types/franchiseSettlement";

/** Mirrors `RecordSettlementRequest.amountPaise` (le 10_000_000_000 paise). */
export const MAX_SETTLEMENT_RUPEES = 100_000_000;
const UTR = /^[A-Za-z0-9]{6,35}$/;

/** `YYYY-MM-DD` for a Date in LOCAL time (the day the person sees). */
export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The oldest day the server accepts: one year back. */
export function oldestAllowedDay(today: Date): string {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - 1);
  return isoDay(d);
}

/**
 * The record-a-transfer form. `needsFranchisee` is the staff door (the company
 * names which franchisee it paid); the portal never has the field.
 * `today` is injectable so the date rules are testable.
 */
export function recordSettlementSchema({
  needsFranchisee,
  today = new Date(),
}: {
  needsFranchisee: boolean;
  today?: Date;
}) {
  const latest = isoDay(today);
  const oldest = oldestAllowedDay(today);
  return z
    .object({
      franchiseeId: z.string(),
      amount: z
        .number({ error: "Enter the amount sent" })
        .min(0.01, "At least ₹0.01")
        // Compared with a tolerance: `3200.5 * 100` is not exact in binary.
        .refine(
          (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
          "Use at most two decimal places"
        )
        .max(MAX_SETTLEMENT_RUPEES, "That is more than one transfer can be"),
      reason: z.enum(SETTLEMENT_REASONS as [string, ...string[]], {
        error: "Pick what it was for",
      }),
      note: z.string().trim().max(500, "Keep the note under 500 characters"),
      transferredOn: z
        .string()
        .min(1, "Enter the day it was sent")
        .refine((v) => v === "" || v <= latest, "That day is in the future")
        .refine((v) => v === "" || v >= oldest, "That is more than a year ago"),
      utr: z
        .string()
        .trim()
        .refine(
          (v) => v === "" || UTR.test(v.replace(/\s+/g, "")),
          "Letters and digits only, 6 to 35 of them — as the bank prints it"
        ),
      screenshot: z
        .instanceof(File)
        .nullable()
        // Explicit boolean: otherwise TS infers a type predicate and the
        // output type diverges from the form's `null` default.
        .refine((f): boolean => f !== null, "Attach the payment screenshot"),
    })
    .superRefine((v, ctx) => {
      if (needsFranchisee && !v.franchiseeId) {
        ctx.addIssue({
          code: "custom",
          path: ["franchiseeId"],
          message: "Pick the franchisee",
        });
      }
      if (v.reason === "other" && !v.note) {
        ctx.addIssue({
          code: "custom",
          path: ["note"],
          message: "Say what this was for",
        });
      }
    });
}

export type RecordSettlementValues = z.infer<
  ReturnType<typeof recordSettlementSchema>
>;
