/**
 * The speed-rule dialog's validation, as a PURE function the Zod schema merely
 * calls (`validateSpeedRow`) — so the duplicate check, the band ordering and the
 * bounds are tested without rendering a form.
 *
 * Bounds are Task 11's `SpeedRuleIn`: hours integers 1–720, amounts whole
 * rupees 0–10 000 (paise 0–1 000 000, a multiple of 100), and
 * `penaltyAfterHours ≥ rewardWithinHours`. `0 / 0` is legal and is how one
 * product is switched OFF beneath a category that has a rule (W2).
 *
 * ⚠ The PUT is an UPSERT on type + target. An "add" that names a pair already
 * in the matrix would silently overwrite it, so on ADD the duplicate is
 * refused here — that check is the only thing standing between the button and
 * somebody's existing numbers.
 */

import { z } from "zod";
import type { SpeedRule, SpeedRuleInput } from "@/types/allowances";
import {
  TYPE_OPTIONS,
  TYPE_WORD_TO_WIRE,
  wireTypeToWord,
  type TypeWord,
} from "@/components/technicians/technicianType";

export interface SpeedRowValues {
  /** The WORD, as `ChoiceCards` holds it; converted to the wire at submit. */
  technicianType: TypeWord;
  /** "" until a target is chosen. */
  targetKind: "" | "node" | "model";
  targetId: string;
  /** Display only — names the target in the duplicate sentence. */
  targetName: string;
  rewardWithinHours: string;
  rewardRupees: string;
  penaltyAfterHours: string;
  penaltyRupees: string;
}

export type SpeedRowField = keyof SpeedRowValues;
export type SpeedRowErrors = Partial<Record<SpeedRowField, string>>;

const HOURS_MSG = "Between 1 and 720 hours";
const RUPEES_MAX = 10_000;
/** "Freelancers" / "Employees" — the filter pills' words. */
const TYPE_PLURAL: Record<TypeWord, string> = {
  Freelancer: "Freelancers",
  Employee: "Employees",
};

const isHours = (v: string) => /^\d{1,4}$/.test(v) && +v >= 1 && +v <= 720;

/** Everything wrong with one row, by field. Empty = valid. */
export function validateSpeedRow(
  values: SpeedRowValues,
  existing: readonly SpeedRule[],
  editingId?: string
): SpeedRowErrors {
  const errors: SpeedRowErrors = {};

  if (values.targetKind === "" || values.targetId === "") {
    errors.targetId = "Choose category or product";
  } else if (!editingId) {
    const type = TYPE_WORD_TO_WIRE[values.technicianType];
    const taken = existing.some(
      (r) =>
        r.technicianType === type &&
        r.targetKind === values.targetKind &&
        r.targetId === values.targetId
    );
    if (taken) {
      errors.targetId = `There is already a rule for ${values.targetName || "this target"} for ${TYPE_PLURAL[values.technicianType]}. Edit that one instead.`;
    }
  }

  if (!isHours(values.rewardWithinHours)) {
    errors.rewardWithinHours = HOURS_MSG;
  }
  if (!isHours(values.penaltyAfterHours)) {
    errors.penaltyAfterHours = HOURS_MSG;
  } else if (
    isHours(values.rewardWithinHours) &&
    Number(values.penaltyAfterHours) < Number(values.rewardWithinHours)
  ) {
    errors.penaltyAfterHours = "The penalty can't start before the reward ends";
  }

  for (const [field, raw] of [
    ["rewardRupees", values.rewardRupees],
    ["penaltyRupees", values.penaltyRupees],
  ] as const) {
    const v = raw.trim();
    if (!/^\d{1,7}$/.test(v)) errors[field] = "Enter a whole number of rupees";
    else if (Number(v) > RUPEES_MAX) errors[field] = "Up to ₹10,000";
  }

  return errors;
}

/** The Zod schema over the form — `superRefine` only calls the pure function. */
export const speedRowSchema = (
  existing: readonly SpeedRule[],
  editingId?: string
) =>
  z
    .object({
      technicianType: z.enum(TYPE_OPTIONS),
      targetKind: z.enum(["", "node", "model"]),
      targetId: z.string(),
      targetName: z.string(),
      rewardWithinHours: z.string(),
      rewardRupees: z.string(),
      penaltyAfterHours: z.string(),
      penaltyRupees: z.string(),
    })
    .superRefine((values, ctx) => {
      const errors = validateSpeedRow(values, existing, editingId);
      for (const [field, message] of Object.entries(errors)) {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    });

/** A blank add form. */
export const emptySpeedValues = (): SpeedRowValues => ({
  technicianType: "Freelancer",
  targetKind: "",
  targetId: "",
  targetName: "",
  rewardWithinHours: "",
  rewardRupees: "",
  penaltyAfterHours: "",
  penaltyRupees: "",
});

/** An existing row, as the edit form holds it. */
export const toSpeedValues = (r: SpeedRule): SpeedRowValues => ({
  technicianType: wireTypeToWord(r.technicianType),
  targetKind: r.targetKind,
  targetId: r.targetId,
  targetName: r.targetName,
  rewardWithinHours: String(r.rewardWithinHours),
  rewardRupees: String(r.rewardPaise / 100),
  penaltyAfterHours: String(r.penaltyAfterHours),
  penaltyRupees: String(r.penaltyPaise / 100),
});

/** The PUT body — rupees to paise, the target to exactly one of the two ids. */
export function toSpeedBody(v: SpeedRowValues): SpeedRuleInput {
  return {
    technicianType: TYPE_WORD_TO_WIRE[v.technicianType],
    nodeId: v.targetKind === "node" ? v.targetId : null,
    modelId: v.targetKind === "model" ? v.targetId : null,
    rewardWithinHours: Number(v.rewardWithinHours),
    penaltyAfterHours: Number(v.penaltyAfterHours),
    rewardPaise: Number(v.rewardRupees) * 100,
    penaltyPaise: Number(v.penaltyRupees) * 100,
  };
}
