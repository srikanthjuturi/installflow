import { z } from "zod";
import type { PlatformSettings, PlatformSettingsInput } from "@/types/platform";

/** The server's own VPA shape (`core/upi.py`), for a faster message only. */
const VPA = /^[a-z0-9][a-z0-9._-]{1,48}@[a-z][a-z0-9]{1,29}$/;

/** Bounds mirror `LIMITS` in `api/app/models/credits.py`. */
function count(label: string, min: number, max: number) {
  return z
    .number({ error: `Enter ${label}` })
    .int("Whole numbers only")
    .min(min, `At least ${min.toLocaleString("en-IN")}`)
    .max(max, `At most ${max.toLocaleString("en-IN")}`);
}

export const platformRulesSchema = z
  .object({
    freeCredits: count("the free credits", 0, 1_000_000),
    ticketCredits: count("the credits per ticket", 0, 10_000),
    minusCreditLimit: count("the minus credit limit", 0, 1_000_000),
    minRechargeRupees: count("the minimum recharge", 1, 100_000),
    upiId: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || VPA.test(v), "Enter a UPI ID like name@bank"),
    upiName: z
      .string()
      .trim()
      .refine((v) => v === "" || (v.length >= 2 && v.length <= 80), "Enter the name on the UPI account"),
  })
  .superRefine((v, ctx) => {
    // Both or neither — an address with no name to check it against is half a
    // payee, and the API refuses it too.
    if (v.upiId && !v.upiName) {
      ctx.addIssue({ code: "custom", path: ["upiName"], message: "Enter the name on the UPI account" });
    }
    if (v.upiName && !v.upiId) {
      ctx.addIssue({ code: "custom", path: ["upiId"], message: "Enter the UPI ID" });
    }
  });

export type PlatformRulesValues = z.infer<typeof platformRulesSchema>;

export function toFormValues(s: PlatformSettings): PlatformRulesValues {
  return {
    freeCredits: s.freeCredits,
    ticketCredits: s.ticketCredits,
    minusCreditLimit: s.minusCreditLimit,
    minRechargeRupees: s.minRechargeRupees,
    upiId: s.upiId ?? "",
    upiName: s.upiName ?? "",
  };
}

export function toInput(v: PlatformRulesValues): PlatformSettingsInput {
  return {
    freeCredits: v.freeCredits,
    ticketCredits: v.ticketCredits,
    minusCreditLimit: v.minusCreditLimit,
    minRechargeRupees: v.minRechargeRupees,
    upiId: v.upiId || null,
    upiName: v.upiName || null,
  };
}
