/**
 * One speed-matrix row, as the table prints it — PURE, so the wording is
 * tested (`speedRows.test.ts`) rather than eyeballed. The §5.10 PROPOSED
 * strings live here and nowhere else.
 */

import { plural } from "@/lib/plural";
import { moneyPaise } from "@/utils/money";
import type { SpeedRule } from "@/types/allowances";

export interface SpeedRowView {
  /** `Electronics › Television`, or the product's full path. */
  target: string;
  /** `Within 12 h · ₹200`, or `—` when the reward is ₹0. */
  reward: string;
  /** `After 24 h · −₹150`, or `—` when the penalty is ₹0. */
  penalty: string;
  /** Every hint that applies, in the order below, joined — null when none. */
  hint: string | null;
  hints: string[];
  /** True for the `0 / 0` row: speed is switched off for this target. */
  off: boolean;
}

export const PATH_SEPARATOR = " › ";

/**
 * The server's `targetPath` is root-first and already ENDS with the target's own
 * name (a model's is its node's path plus its name). If a build ever sends the
 * ancestors alone, the name is appended — never printed twice.
 */
export function targetLabel(rule: Pick<SpeedRule, "targetPath" | "targetName">) {
  const path = rule.targetPath.filter(Boolean);
  if (path.length === 0) return rule.targetName;
  return path[path.length - 1] === rule.targetName
    ? path.join(PATH_SEPARATOR)
    : [...path, rule.targetName].join(PATH_SEPARATOR);
}

export function speedRowView(rule: SpeedRule): SpeedRowView {
  const off = rule.rewardPaise === 0 && rule.penaltyPaise === 0;

  const hints: string[] = [];
  if (!rule.targetActive) hints.push("No longer in the catalogue");
  if (off) hints.push("Off for this product");
  if (rule.overridesName) hints.push(`Overrides ${rule.overridesName}`);
  if (rule.overriddenBy > 0) {
    hints.push(
      rule.overriddenBy === 1
        ? "1 deeper rule overrides this"
        : `${plural(rule.overriddenBy, "deeper rule")} override this`
    );
  }

  return {
    target: targetLabel(rule),
    reward:
      rule.rewardPaise > 0
        ? `Within ${rule.rewardWithinHours} h · ${moneyPaise(rule.rewardPaise)}`
        : "—",
    penalty:
      rule.penaltyPaise > 0
        ? `After ${rule.penaltyAfterHours} h · ${moneyPaise(-rule.penaltyPaise)}`
        : "—",
    hint: hints.length ? hints.join(" · ") : null,
    hints,
    off,
  };
}
