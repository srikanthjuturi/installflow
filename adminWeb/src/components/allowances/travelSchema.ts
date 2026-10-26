/**
 * The travel-rules form: Zod over what is TYPED (strings, in whole rupees and
 * kilometres — the `ForceCloseForm` convention), and the two conversions at the
 * edge (rupees ⇄ the wire's paise).
 *
 * Bounds are Task 10's `TravelRuleIO` / `TRAVEL_LIMITS` — `freeKm` 0–500,
 * `stepKm` 1–50, `paisePerStep` 0–1 000 000, `roadFactorPct` 100–300,
 * `maxPaisePerJob` 0–10 000 000 — said in the units a person types. The server
 * re-checks all of it; this only saves the round trip and puts the sentence on
 * the field.
 */

import { z } from "zod";
import type { TravelRule, TravelRules } from "@/types/allowances";
import type { TechnicianType } from "@/types/technician";
import { paiseToRupeeInput } from "@/utils/money";

/** The type rows, in the order the cards are drawn: freelancers first. */
export const TRAVEL_TYPES = [
  "freelancer",
  "employee",
] as const satisfies readonly TechnicianType[];

const MAX_PER_STEP_RUPEES = 10_000; // 1 000 000 paise
const MAX_PER_JOB_RUPEES = 100_000; // 10 000 000 paise

/** The server's W2 sentence, said client-side so the field shows it unsent. */
export const MAX_NEEDED =
  "Set a maximum per job — with a ₹0 maximum the allowance is always ₹0.";

const wholeKm = (min: number, max: number, range: string) =>
  z
    .string()
    .trim()
    .refine((v) => /^\d{1,4}$/.test(v), "Enter a whole number of kilometres")
    .refine((v) => Number(v) >= min && Number(v) <= max, range);

const wholeRupees = (max: number, range: string) =>
  z
    .string()
    .trim()
    .refine((v) => /^\d{1,7}$/.test(v), "Enter a whole number of rupees")
    .refine((v) => Number(v) <= max, range);

const ruleSchema = z
  .object({
    freeKm: wholeKm(0, 500, "Between 0 and 500 km"),
    stepKm: wholeKm(1, 50, "Between 1 and 50 km"),
    perStep: wholeRupees(MAX_PER_STEP_RUPEES, "Up to ₹10,000"),
    roadFactorPct: z
      .string()
      .trim()
      .refine((v) => /^\d{1,3}$/.test(v), "Between 100 % and 300 %")
      .refine((v) => Number(v) >= 100 && Number(v) <= 300, "Between 100 % and 300 %"),
    maxPerJob: wholeRupees(MAX_PER_JOB_RUPEES, "Up to ₹1,00,000"),
  })
  .superRefine((v, ctx) => {
    // W2 — a rate above ₹0 with a ₹0 ceiling is always ₹0. Only once both
    // boxes hold clean numbers, so it never stacks on a format error.
    if (/^\d+$/.test(v.perStep) && /^\d+$/.test(v.maxPerJob)) {
      if (Number(v.perStep) > 0 && Number(v.maxPerJob) === 0) {
        ctx.addIssue({ code: "custom", path: ["maxPerJob"], message: MAX_NEEDED });
      }
    }
  });

export const travelSchema = z.object({
  freelancer: ruleSchema,
  employee: ruleSchema,
});

export type TravelRuleValues = z.infer<typeof ruleSchema>;
export type TravelValues = z.infer<typeof travelSchema>;

const ruleToValues = (r: TravelRule): TravelRuleValues => ({
  freeKm: String(r.freeKm),
  stepKm: String(r.stepKm),
  perStep: paiseToRupeeInput(r.paisePerStep),
  roadFactorPct: String(r.roadFactorPct),
  maxPerJob: paiseToRupeeInput(r.maxPaisePerJob),
});

const ruleToBody = (v: TravelRuleValues): TravelRule => ({
  freeKm: Number(v.freeKm),
  stepKm: Number(v.stepKm),
  paisePerStep: Number(v.perStep) * 100,
  roadFactorPct: Number(v.roadFactorPct),
  maxPaisePerJob: Number(v.maxPerJob) * 100,
});

/** The server's rules, as the form holds them (rupees, strings). */
export const toTravelValues = (rules: TravelRules): TravelValues => ({
  freelancer: ruleToValues(rules.freelancer),
  employee: ruleToValues(rules.employee),
});

/** The form's values, as the PUT carries them (paise). Both types, always. */
export const toTravelBody = (values: TravelValues): TravelRules => ({
  freelancer: ruleToBody(values.freelancer),
  employee: ruleToBody(values.employee),
});

/**
 * The paise rule behind ONE card's boxes, or null while any box is not yet a
 * number — what `TravelPreview` explains. It deliberately does not run the
 * bounds: a preview of `free 600 km` is still honest arithmetic, and the field
 * carries its own error.
 */
export function previewRule(v: Partial<TravelRuleValues> | undefined): TravelRule | null {
  if (!v) return null;
  const int = /^\d+$/;
  if (
    !int.test(v.freeKm ?? "") ||
    !int.test(v.stepKm ?? "") ||
    !int.test(v.perStep ?? "") ||
    !int.test(v.roadFactorPct ?? "") ||
    !int.test(v.maxPerJob ?? "")
  ) {
    return null;
  }
  const rule = ruleToBody(v as TravelRuleValues);
  return rule.stepKm >= 1 ? rule : null;
}
