/**
 * The travel allowance's arithmetic, in the browser — a LINE-FOR-LINE MIRROR of
 * `api/app/core/travel.py` (Task 10 §4.1). Change the two together, and change
 * the parity table in `travelPreview.test.ts` with them: it is the Python
 * `test_travel.py` rows copied verbatim, and it is what notices a drift.
 * (`mobileapp/src/lib/coordinates.ts` is the precedent for this habit.)
 *
 * The preview is an explanation, never the figure that is paid: the server
 * computes and freezes the amount at accept. If this ever disagrees with a
 * ticket's `travel.amountPaise`, the server is right and this file is stale.
 *
 * Distance is one way, base → customer, straight line × a road factor. Done in
 * integer TENTHS of a km (W1) so the km a technician is shown is exactly the km
 * they are paid for, and a partial step is dropped (TA3).
 *
 * PURE: no I/O, no clock, no React.
 */

import type { TravelRule } from "@/types/allowances";
import { moneyPaise } from "@/utils/money";

/** Half-up to integer tenths of a km. 26.000000000000004 → 260. */
export const tenths = (km: number): number => Math.floor(km * 10 + 0.5);

/**
 * `road_km`: straight METRES × factor, as km rounded half-up to 0.1.
 * Python raises on a negative distance or a factor below 1; here that is 0 —
 * a preview box mid-typing must never throw.
 */
export function roadKm(straightM: number, factorPct: number): number {
  if (!Number.isFinite(straightM) || !Number.isFinite(factorPct)) return 0;
  if (straightM < 0 || factorPct < 1) return 0;
  return Math.floor((straightM * factorPct) / 10_000 + 0.5) / 10;
}

/**
 * `travel_amount_paise`: min(max, floor(max(0, km − free) / step) × rate).
 * Never negative; an out-of-range input (Python's ValueError) reads 0.
 */
export function travelAmountPaise(km: number, rule: TravelRule): number {
  const { freeKm, stepKm, paisePerStep, maxPaisePerJob } = rule;
  if (
    !Number.isFinite(km) ||
    km < 0 ||
    freeKm < 0 ||
    stepKm < 1 ||
    paisePerStep < 0 ||
    maxPaisePerJob < 0
  ) {
    return 0;
  }
  const beyond = Math.max(0, tenths(km) - freeKm * 10);
  const steps = Math.floor(beyond / (stepKm * 10));
  return Math.min(maxPaisePerJob, steps * paisePerStep);
}

export interface TravelExplanation {
  /** Straight line × the road factor, to 0.1 km. */
  roadKm: number;
  /** Km past the free distance, to 0.1 km (0 when within it). */
  beyondKm: number;
  /** Whole steps paid; the partial one is dropped. */
  steps: number;
  /** steps × rate, before the cap. */
  rawPaise: number;
  /** What would be paid. */
  amountPaise: number;
  /** The cap cut the raw figure. */
  capped: boolean;
  /** The rate is ₹0 — the allowance is switched off. */
  off: boolean;
}

/** The worked example under a rule: every line `TravelPreview` prints. */
export function explainTravel(
  straightKm: number,
  rule: TravelRule
): TravelExplanation {
  const road = roadKm(straightKm * 1000, rule.roadFactorPct);
  const beyondTenths = Math.max(0, tenths(road) - rule.freeKm * 10);
  const steps =
    rule.stepKm >= 1 ? Math.floor(beyondTenths / (rule.stepKm * 10)) : 0;
  const rawPaise = Math.max(0, steps * rule.paisePerStep);
  const amountPaise = travelAmountPaise(road, rule);
  return {
    roadKm: road,
    beyondKm: beyondTenths / 10,
    steps,
    rawPaise,
    amountPaise,
    capped: rawPaise > amountPaise,
    off: rule.paisePerStep === 0,
  };
}

/**
 * The worked lines `TravelPreview` prints (§5.10 PROPOSED copy), in order, plus
 * the verdict. Pure, so the wording is tested alongside the arithmetic.
 *
 *   28.1 km  → "21.6 km × 130 % = 28.1 km by road"
 *            → "8.1 km beyond the free 20 km = 4 steps of 2 km"
 *            → "4 × ₹10 = ₹40"   (+ "Capped at ₹300" when the cap cut it)
 *            → "Pays ₹40"
 */
export function describeTravel(
  straightKm: number,
  rule: TravelRule
): { lines: string[]; verdict: string } {
  const x = explainTravel(straightKm, rule);
  const shown = Number.isFinite(straightKm) && straightKm >= 0 ? straightKm : 0;
  const lines = [
    `${shown} km × ${rule.roadFactorPct} % = ${x.roadKm} km by road`,
  ];

  if (x.off) {
    return { lines, verdict: "Pays nothing — the allowance is off" };
  }
  if (x.beyondKm <= 0) {
    return { lines, verdict: "Pays nothing — within the free distance" };
  }

  lines.push(
    `${x.beyondKm} km beyond the free ${rule.freeKm} km = ${x.steps} ${x.steps === 1 ? "step" : "steps"} of ${rule.stepKm} km`
  );
  if (x.steps > 0) {
    lines.push(
      `${x.steps} × ${moneyPaise(rule.paisePerStep)} = ${moneyPaise(x.rawPaise)}`
    );
  }
  if (x.capped) lines.push(`Capped at ${moneyPaise(rule.maxPaisePerJob)}`);

  return {
    lines,
    verdict:
      x.amountPaise > 0
        ? `Pays ${moneyPaise(x.amountPaise)}`
        : "Pays nothing — within the free distance",
  };
}
