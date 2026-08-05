import type { RulesConfig } from "@/services/settings";
import { z } from "zod";

/** Hours field shared by the three timing rules. */
const hours = (max: number, label: string) =>
  z
    .number({ error: `${label} is required` })
    .int(`${label} must be a whole number of hours`)
    .min(1, `${label} must be at least 1 hour`)
    .max(max, `${label} cannot exceed ${max} hours`);

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
        }),
      )
      .length(4),
    penaltyCap: z
      .number({ error: "Enter a monthly cap" })
      .int("Use whole rupees")
      .min(0, "A cap cannot be negative"),
    aiThreshold: z.number().int().min(50).max(95),
    slotConfirmTimeoutHours: hours(72, "Slot-confirm timeout"),
    escalationTriggerHours: hours(48, "Escalation trigger"),
    customerWaitHours: hours(240, "Customer wait period"),
    bandwidthModel: z.enum(["count", "weighted"]),
  })
  .superRefine((v, ctx) => {
    // A band that charges less the later you cancel would invert the whole
    // incentive: the penalty exists because a late cancellation is costlier.
    for (let i = 1; i < v.penalty.length; i += 1) {
      if (v.penalty[i].amount < v.penalty[i - 1].amount) {
        ctx.addIssue({
          code: "custom",
          path: ["penalty", i, "amount"],
          message: "Later cancellations must cost at least as much as earlier ones",
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

export const BANDWIDTH_OPTIONS = [
  {
    value: "count" as const,
    label: "Jobs per day",
    detail: "A plain 1–12 cap. What the technician record and the field app use.",
  },
  {
    value: "weighted" as const,
    label: "Weighted by job type",
    detail: "Capacity varies by job. Not modelled anywhere else yet.",
  },
];

/** Maps the served config onto the form's shape. Lives beside the schema so
 *  RulesForm.tsx exports components only and fast refresh keeps working. */
export function toFormValues(rules: RulesConfig): RulesFormValues {
  return {
    penalty: rules.penalty.map((b) => ({ band: b.band, amount: b.amount })),
    penaltyCap: rules.penaltyCap,
    aiThreshold: rules.ai.threshold,
    slotConfirmTimeoutHours: rules.slotConfirmTimeoutHours,
    escalationTriggerHours: rules.escalationTriggerHours,
    customerWaitHours: rules.customerWaitHours,
    bandwidthModel: rules.bandwidthModel,
  };
}
