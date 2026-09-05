import { z } from "zod";
import type { NodeRulesConfig, NodeRuleValues } from "@/services/settings";

/**
 * One category's overrides. **Empty means inherit** — that is the whole shape.
 *
 * Every box is a STRING here, not a number, and that is the load-bearing
 * difference from `rulesSchema`. `valueAsNumber` on an empty box yields `NaN`,
 * which zod reports as "expected number, received nan" — unactionable, and
 * indistinguishable from the perfectly good answer of "leave this alone". A
 * string tells the two apart: `""` is inherit, anything else is an override.
 *
 * ## What is NOT validated here
 *
 * The cross-field rules — escalation shorter than the slot-confirm timeout, the
 * cap above the largest penalty. They cannot be checked on this form: it holds
 * one node's overrides, and a violation only appears once the value is resolved
 * against everything this node inherits. The server checks the resolved set —
 * for this node AND every other node carrying an override — and answers with a
 * 400 naming the category. See `api/app/features/settings/service.py`.
 *
 * ## `penaltyCap` is absent
 *
 * A monthly cap bounds a technician across every job they took, so it cannot
 * have a different answer per product. It stays on the company screen.
 */

/** An optional whole number in `[min, max]`. Blank passes — it means inherit. */
const optional = (min: number, max: number, label: string, unit: string) =>
  z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^\d{1,7}$/.test(v),
      `${label} must be a whole number of ${unit}`
    )
    .refine(
      (v) => v === "" || Number(v) >= min,
      `${label} must be at least ${min} ${unit}`
    )
    .refine(
      (v) => v === "" || Number(v) <= max,
      `${label} cannot exceed ${max} ${unit}`
    );

/**
 * A band list is overridden WHOLE — all four boxes or none.
 *
 * Not a UI preference: inheriting the first two bands and overriding the third
 * would make `cancel_penalties_paise[2]` mean different things at different
 * depths, and the column's CHECK refuses a list that is not exactly four long.
 */
const bandList = () => z.array(z.object({ amount: z.string().trim() })).length(4);

export const nodeRulesSchema = z
  .object({
    penalty: bandList(),
    bonusAmounts: bandList(),
    aiThreshold: optional(50, 95, "AI threshold", "percent"),
    slaWarnAtPct: optional(1, 99, "Due-soon threshold", "percent"),
    slotConfirmTimeoutHours: optional(1, 72, "Slot-confirm timeout", "hours"),
    escalationTriggerHours: optional(1, 48, "Escalation trigger", "hours"),
    customerWaitHours: optional(1, 240, "Customer wait period", "hours"),
    renotifyGraceMinutes: optional(5, 720, "Re-notification grace", "minutes"),
    slotReminderMinutes: optional(5, 1440, "Slot reminder", "minutes"),
    customerNoticeMinutes: optional(5, 1440, "Customer notice", "minutes"),
    geoRadiusM: optional(50, 5000, "Proof radius", "metres"),
  })
  .superRefine((v, ctx) => {
    const checkList = (
      rows: { amount: string }[],
      path: "penalty" | "bonusAmounts",
      what: string,
      floor: number
    ) => {
      const filled = rows.filter((r) => r.amount !== "").length;
      if (filled !== 0 && filled !== rows.length) {
        rows.forEach((row, i) => {
          if (row.amount === "") {
            ctx.addIssue({
              code: "custom",
              path: [path, i, "amount"],
              message: `Set all four ${what} bands, or clear them all to inherit`,
            });
          }
        });
        return;
      }
      if (filled === 0) return;

      rows.forEach((row, i) => {
        if (!/^\d{1,7}$/.test(row.amount)) {
          ctx.addIssue({
            code: "custom",
            path: [path, i, "amount"],
            message: "Use whole rupees",
          });
        } else if (Number(row.amount) < floor) {
          ctx.addIssue({
            code: "custom",
            path: [path, i, "amount"],
            message:
              floor === 1
                ? "A bonus must be more than ₹0"
                : "A penalty cannot be negative",
          });
        }
      });
    };

    checkList(v.penalty, "penalty", "penalty", 0);
    // ₹0 is the absence of an incentive, not a small one — the API's own floor.
    checkList(v.bonusAmounts, "bonusAmounts", "bonus", 1);

    // Monotonicity is checkable HERE because a list is overridden whole, so all
    // four values are on this form or none are. The cross-field rules that span
    // inheritance are not, and are left to the server.
    const amounts = (rows: { amount: string }[]) =>
      rows.every((r) => r.amount !== "") ? rows.map((r) => Number(r.amount)) : null;

    const penalties = amounts(v.penalty);
    if (penalties) {
      for (let i = 1; i < penalties.length; i += 1) {
        if (penalties[i] < penalties[i - 1]) {
          ctx.addIssue({
            code: "custom",
            path: ["penalty", i, "amount"],
            message:
              "Later cancellations must cost at least as much as earlier ones",
          });
        }
      }
    }
    const bonuses = amounts(v.bonusAmounts);
    if (bonuses) {
      for (let i = 1; i < bonuses.length; i += 1) {
        if (bonuses[i] <= bonuses[i - 1]) {
          ctx.addIssue({
            code: "custom",
            path: ["bonusAmounts", i, "amount"],
            message: "Each band must be more than the one before it",
          });
        }
      }
    }
  });

export type NodeRulesFormValues = z.infer<typeof nodeRulesSchema>;

const text = (value: number | null) => (value === null ? "" : String(value));

/** The served overrides onto the form's shape. Nulls become empty boxes. */
export function toNodeFormValues(config: NodeRulesConfig): NodeRulesFormValues {
  const own = config.own;
  // Wrapped in objects because `useFieldArray` keys on one, which is also what
  // stops the inputs losing focus on re-render — the same reason `rulesSchema`
  // wraps its bonus amounts.
  const list = (values: number[] | null) =>
    (values ?? [null, null, null, null]).map((amount) => ({
      amount: text(amount as number | null),
    }));

  return {
    penalty: list(own.penalty),
    bonusAmounts: list(own.bonusAmounts),
    aiThreshold: text(own.aiThreshold),
    slaWarnAtPct: text(own.slaWarnAtPct),
    slotConfirmTimeoutHours: text(own.slotConfirmTimeoutHours),
    escalationTriggerHours: text(own.escalationTriggerHours),
    customerWaitHours: text(own.customerWaitHours),
    renotifyGraceMinutes: text(own.renotifyGraceMinutes),
    slotReminderMinutes: text(own.slotReminderMinutes),
    customerNoticeMinutes: text(own.customerNoticeMinutes),
    geoRadiusM: text(own.geoRadiusM),
  };
}

const num = (value: string) => (value.trim() === "" ? null : Number(value));

/** The form's shape back onto the wire's. Empty boxes become explicit nulls. */
export function toNodeDraft(values: NodeRulesFormValues): NodeRuleValues {
  const list = (rows: { amount: string }[]) =>
    rows.every((r) => r.amount.trim() === "")
      ? null
      : rows.map((r) => Number(r.amount));

  return {
    penalty: list(values.penalty),
    bonusAmounts: list(values.bonusAmounts),
    aiThreshold: num(values.aiThreshold),
    slaWarnAtPct: num(values.slaWarnAtPct),
    slotConfirmTimeoutHours: num(values.slotConfirmTimeoutHours),
    escalationTriggerHours: num(values.escalationTriggerHours),
    customerWaitHours: num(values.customerWaitHours),
    renotifyGraceMinutes: num(values.renotifyGraceMinutes),
    slotReminderMinutes: num(values.slotReminderMinutes),
    customerNoticeMinutes: num(values.customerNoticeMinutes),
    geoRadiusM: num(values.geoRadiusM),
  };
}

/** Does this node override anything at all? Drives the Reset button. */
export function overridesAnything(values: NodeRuleValues): boolean {
  return Object.values(values).some((value) => value !== null);
}
