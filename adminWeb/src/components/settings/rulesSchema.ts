import type { RulesConfig, RulesConfigDraft } from "@/services/settings";
import { z } from "zod";

/**
 * Bounds are stated three times on purpose — here, in the API's request schema,
 * and as CHECK constraints on `company_rules` — because each catches a
 * different writer. These exist to give a message beside the field before a
 * round trip; the server's are the authority, and a 422 from it is still
 * rendered rather than assumed impossible.
 */

/** Hours field shared by the three timing rules measured in hours. */
const hours = (max: number, label: string) =>
  z
    .number({ error: `${label} is required` })
    .int(`${label} must be a whole number of hours`)
    .min(1, `${label} must be at least 1 hour`)
    .max(max, `${label} cannot exceed ${max} hours`);

/** Minutes field shared by the two rules the sweep measures in minutes. */
const minutes = (min: number, max: number, label: string) =>
  z
    .number({ error: `${label} is required` })
    .int(`${label} must be a whole number of minutes`)
    .min(min, `${label} must be at least ${min} minutes`)
    .max(max, `${label} cannot exceed ${max} minutes`);

export const rulesSchema = z
  .object({
    penalty: z
      .array(
        z.object({
          band: z.string(),
          amount: z
            .number({ error: "Enter an amount" })
            .int("Use whole rupees")
            .min(0, "A penalty cannot be negative")
            .max(100000, "That is above any plausible penalty"),
        })
      )
      .length(4),
    penaltyCap: z
      .number({ error: "Enter a monthly cap" })
      .int("Use whole rupees")
      .min(0, "A cap cannot be negative"),
    bonusAmounts: z
      .array(
        z.object({
          amount: z
            .number({ error: "Enter an amount" })
            .int("Use whole rupees")
            // The API's floor, not a UI preference: `BonusRequest` takes
            // `gt=0` because ₹0 is the absence of an incentive, not a small
            // one — and the absence is spelled "do not fund a bonus".
            .min(1, "A bonus must be more than ₹0")
            .max(100000, "That is above any plausible bonus"),
        })
      )
      .length(4),
    aiThreshold: z.number().int().min(50).max(95),
    slaWarnAtPct: z
      .number({ error: "Enter a percentage" })
      .int("Use a whole percentage")
      .min(1, "Must be at least 1%")
      .max(99, "Must be under 100%"),
    slotConfirmTimeoutHours: hours(72, "Slot-confirm timeout"),
    escalationTriggerHours: hours(48, "Escalation trigger"),
    customerWaitHours: hours(240, "Customer wait period"),
    renotifyGraceMinutes: minutes(5, 720, "Re-notification grace"),
    slotReminderMinutes: minutes(5, 1440, "Slot reminder"),
  })
  .superRefine((v, ctx) => {
    // A band that charges less the later you cancel would invert the whole
    // incentive: the penalty exists because a late cancellation is costlier.
    for (let i = 1; i < v.penalty.length; i += 1) {
      if (v.penalty[i].amount < v.penalty[i - 1].amount) {
        ctx.addIssue({
          code: "custom",
          path: ["penalty", i, "amount"],
          message:
            "Later cancellations must cost at least as much as earlier ones",
        });
      }
    }
    // Chips are a row of increasing offers, so equal or falling neighbours
    // would render two identical buttons — or one that reads as a downgrade.
    // Strictly ascending, unlike the penalty bands, where two bands charging
    // the same is merely unusual rather than broken.
    for (let i = 1; i < v.bonusAmounts.length; i += 1) {
      if (v.bonusAmounts[i].amount <= v.bonusAmounts[i - 1].amount) {
        ctx.addIssue({
          code: "custom",
          path: ["bonusAmounts", i, "amount"],
          message: "Each band must be more than the one before it",
        });
      }
    }
    // A cap below the largest single penalty can never bind.
    const worst = Math.max(...v.penalty.map((b) => b.amount));
    if (v.penaltyCap > 0 && v.penaltyCap < worst) {
      ctx.addIssue({
        code: "custom",
        path: ["penaltyCap"],
        message: "The cap is below a single penalty, so it could never apply",
      });
    }
    // Escalating before the customer can even be asked to confirm is a
    // contradiction — the slot has to exist before it can go unassigned.
    if (v.escalationTriggerHours >= v.slotConfirmTimeoutHours) {
      ctx.addIssue({
        code: "custom",
        path: ["escalationTriggerHours"],
        message: "Must be shorter than the slot-confirm timeout",
      });
    }
  });

export type RulesFormValues = z.infer<typeof rulesSchema>;

/** Maps the served config onto the form's shape. Lives beside the schema so
 *  RulesForm.tsx exports components only and fast refresh keeps working. */
export function toFormValues(rules: RulesConfig): RulesFormValues {
  return {
    penalty: rules.penalty.map((b) => ({ band: b.band, amount: b.amount })),
    penaltyCap: rules.penaltyCap,
    // Wrapped in objects because `useFieldArray` keys on one, not on a bare
    // number — which is also what stops the inputs losing focus on re-render.
    bonusAmounts: rules.bonusAmounts.map((amount) => ({ amount })),
    aiThreshold: rules.ai.threshold,
    slaWarnAtPct: rules.slaWarnAtPct,
    slotConfirmTimeoutHours: rules.slotConfirmTimeoutHours,
    escalationTriggerHours: rules.escalationTriggerHours,
    customerWaitHours: rules.customerWaitHours,
    renotifyGraceMinutes: rules.renotifyGraceMinutes,
    slotReminderMinutes: rules.slotReminderMinutes,
  };
}

/**
 * The inverse — the form's shape back onto the wire's.
 *
 * Two things differ, and both are the form's needs rather than the API's: the
 * bonus bands are unwrapped from the `{ amount }` objects `useFieldArray`
 * requires, and the penalty band LABELS are dropped. The server owns those —
 * they name time boundaries, not preferences — and sending them back would
 * invite a client to rename a rule into something it is not.
 */
export function toDraft(values: RulesFormValues): RulesConfigDraft {
  return {
    penalty: values.penalty.map((b) => b.amount),
    penaltyCap: values.penaltyCap,
    bonusAmounts: values.bonusAmounts.map((b) => b.amount),
    aiThreshold: values.aiThreshold,
    slaWarnAtPct: values.slaWarnAtPct,
    slotConfirmTimeoutHours: values.slotConfirmTimeoutHours,
    escalationTriggerHours: values.escalationTriggerHours,
    customerWaitHours: values.customerWaitHours,
    renotifyGraceMinutes: values.renotifyGraceMinutes,
    slotReminderMinutes: values.slotReminderMinutes,
  };
}
