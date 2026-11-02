import { z } from "zod";
import type {
  TechnicianRules,
  TechnicianRulesInput,
} from "@/types/technicianRules";

/**
 * The form for one technician's own rules (Epic 3).
 *
 * Every field is a STRING, because a form box is: an EMPTY box means "inherit"
 * (the server's `null`), and that is not expressible with a number. Rupees are
 * typed, paise are sent — `rupeesToPaise` / `paiseToRupees` are the only
 * conversion. Bounds mirror `api/app/models/technician_rules.py`; the server's
 * are the authority and a 422 from it is still rendered.
 */

export const BAND_COUNT = 4;

/** Labels of the four cancellation bands, in the order the server sends them. */
export const PENALTY_BAND_LABELS = [
  "More than 4 hours before the slot",
  "2 to 4 hours before the slot",
  "Less than 2 hours before the slot",
  "No-show",
] as const;

export const BOUNDS = {
  payoutPercent: [1, 300],
  penaltyPaise: [0, 10_000_000],
  bonusPaise: [1, 10_000_000],
  speedHours: [1, 720],
  speedPaise: [0, 1_000_000],
  travelFreeKm: [0, 500],
  travelRatePaise: [0, 1_000_000],
  travelMaxPaise: [0, 10_000_000],
  redeemPaise: [0, 1_000_000_000],
} as const;

/* ------------------------------------------------------------------ helpers */

/** Nothing typed (or only spaces) — the "inherit" state. */
export const isBlank = (s: string): boolean => s.trim() === "";

/**
 * `"450"` / `"450.5"` / `"450.50"` → paise, or null when it is not a rupee
 * amount of at most two decimals. Integer arithmetic on the digits, never
 * `* 100` on a float (`3200.5 * 100` is `320050.00000000006`).
 */
export function rupeesToPaise(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Paise → the bare rupee digits a box holds: `45000` → `"450"`, `45050` → `"450.50"`. Null → `""`. */
export function paiseToRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const whole = Math.trunc(paise / 100);
  const frac = paise % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

const wholeNumber = (s: string): number | null =>
  /^\d+$/.test(s.trim()) ? Number(s.trim()) : null;

/* -------------------------------------------------------------------- shape */

export interface RulesFormValues {
  payoutPercent: string;
  /** Rupees, always BAND_COUNT boxes. All blank = inherit. */
  penalties: string[];
  bonuses: string[];
  speedRewardHours: string;
  speedPenaltyHours: string;
  speedRewardRupees: string;
  speedPenaltyRupees: string;
  travelFreeKm: string;
  travelPerStepRupees: string;
  travelMaxRupees: string;
  minRedeemableRupees: string;
}

export const SPEED_KEYS = [
  "speedRewardHours",
  "speedPenaltyHours",
  "speedRewardRupees",
  "speedPenaltyRupees",
] as const satisfies readonly (keyof RulesFormValues)[];

export const emptyValues = (): RulesFormValues => ({
  payoutPercent: "",
  penalties: Array(BAND_COUNT).fill(""),
  bonuses: Array(BAND_COUNT).fill(""),
  speedRewardHours: "",
  speedPenaltyHours: "",
  speedRewardRupees: "",
  speedPenaltyRupees: "",
  travelFreeKm: "",
  travelPerStepRupees: "",
  travelMaxRupees: "",
  minRedeemableRupees: "",
});

const str = (n: number | null): string => (n === null ? "" : String(n));
const list = (v: number[] | null): string[] =>
  v && v.length === BAND_COUNT ? v.map(paiseToRupees) : Array(BAND_COUNT).fill("");

/** Server → form. Null becomes an empty box. */
export function toFormValues(r: TechnicianRulesInput): RulesFormValues {
  return {
    payoutPercent: str(r.payoutPercent),
    penalties: list(r.cancelPenaltiesPaise),
    bonuses: list(r.bonusBandsPaise),
    speedRewardHours: str(r.speedRewardWithinHours),
    speedPenaltyHours: str(r.speedPenaltyAfterHours),
    speedRewardRupees: paiseToRupees(r.speedRewardPaise),
    speedPenaltyRupees: paiseToRupees(r.speedPenaltyPaise),
    travelFreeKm: str(r.travelFreeKm),
    travelPerStepRupees: paiseToRupees(r.travelPaisePerStep),
    travelMaxRupees: paiseToRupees(r.travelMaxPaisePerJob),
    minRedeemableRupees: paiseToRupees(r.minRedeemablePaise),
  };
}

/** The inherited values as boxes, to start an override from. */
export function inheritedValues(
  r: TechnicianRules
): Pick<
  RulesFormValues,
  | "payoutPercent"
  | "penalties"
  | "bonuses"
  | "travelFreeKm"
  | "travelPerStepRupees"
  | "travelMaxRupees"
> {
  return {
    payoutPercent: String(r.inherited.payoutPercent),
    penalties: r.inherited.cancelPenaltiesPaise.map(paiseToRupees),
    bonuses: r.inherited.bonusBandsPaise.map(paiseToRupees),
    travelFreeKm: String(r.inherited.travel.freeKm),
    travelPerStepRupees: paiseToRupees(r.inherited.travel.paisePerStep),
    travelMaxRupees: paiseToRupees(r.inherited.travel.maxPaisePerJob),
  };
}

/* ------------------------------------------------------------- which is set */

export type GroupKey = "payout" | "penalties" | "bonuses" | "speed" | "travel";

/** True when the group carries at least one override (any box filled). */
export function isOverridden(v: RulesFormValues, group: GroupKey): boolean {
  switch (group) {
    case "payout":
      return !isBlank(v.payoutPercent);
    case "penalties":
      return v.penalties.some((s) => !isBlank(s));
    case "bonuses":
      return v.bonuses.some((s) => !isBlank(s));
    case "speed":
      return SPEED_KEYS.some((k) => !isBlank(v[k]));
    case "travel":
      return [v.travelFreeKm, v.travelPerStepRupees, v.travelMaxRupees].some(
        (s) => !isBlank(s)
      );
  }
}

/** The form with one group cleared back to inherit. */
export function resetGroup(v: RulesFormValues, group: GroupKey): RulesFormValues {
  const e = emptyValues();
  switch (group) {
    case "payout":
      return { ...v, payoutPercent: "" };
    case "penalties":
      return { ...v, penalties: e.penalties };
    case "bonuses":
      return { ...v, bonuses: e.bonuses };
    case "speed":
      return {
        ...v,
        speedRewardHours: "",
        speedPenaltyHours: "",
        speedRewardRupees: "",
        speedPenaltyRupees: "",
      };
    case "travel":
      return { ...v, travelFreeKm: "", travelPerStepRupees: "", travelMaxRupees: "" };
  }
}

/* ------------------------------------------------------------------- schema */

type Ctx = z.RefinementCtx;
type Path = (string | number)[];

function intField(
  ctx: Ctx,
  path: Path,
  value: string,
  [min, max]: readonly [number, number],
  label: string,
  unit: string
): void {
  if (isBlank(value)) return;
  const n = wholeNumber(value);
  if (n === null) {
    ctx.addIssue({ code: "custom", path, message: `${label} must be a whole number` });
  } else if (n < min || n > max) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `${label} must be ${min} to ${max}${unit}`,
    });
  }
}

function rupeeField(
  ctx: Ctx,
  path: Path,
  value: string,
  [min, max]: readonly [number, number],
  label: string
): void {
  if (isBlank(value)) return;
  const p = rupeesToPaise(value);
  if (p === null) {
    ctx.addIssue({ code: "custom", path, message: `${label} must be an amount in rupees` });
  } else if (p < min || p > max) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `${label} must be ₹${paiseToRupees(min)} to ₹${paiseToRupees(max)}`,
    });
  }
}

function bandList(
  ctx: Ctx,
  key: "penalties" | "bonuses",
  values: string[],
  bounds: readonly [number, number],
  what: string
): void {
  if (values.length !== BAND_COUNT) {
    ctx.addIssue({
      code: "custom",
      path: [key],
      message: `Give exactly ${BAND_COUNT} ${what} amounts`,
    });
    return;
  }
  const any = values.some((s) => !isBlank(s));
  values.forEach((s, i) => {
    if (any && isBlank(s)) {
      ctx.addIssue({
        code: "custom",
        path: [key, i],
        message: "Fill all four, or clear them all to inherit",
      });
    } else {
      rupeeField(ctx, [key, i], s, bounds, "Amount");
    }
  });
}

export const technicianRulesSchema = z
  .object({
    payoutPercent: z.string(),
    penalties: z.array(z.string()),
    bonuses: z.array(z.string()),
    speedRewardHours: z.string(),
    speedPenaltyHours: z.string(),
    speedRewardRupees: z.string(),
    speedPenaltyRupees: z.string(),
    travelFreeKm: z.string(),
    travelPerStepRupees: z.string(),
    travelMaxRupees: z.string(),
    minRedeemableRupees: z.string(),
  })
  .superRefine((v, ctx) => {
    intField(ctx, ["payoutPercent"], v.payoutPercent, BOUNDS.payoutPercent, "Payout", " %");
    bandList(ctx, "penalties", v.penalties, BOUNDS.penaltyPaise, "penalty");
    bandList(ctx, "bonuses", v.bonuses, BOUNDS.bonusPaise, "bonus");

    // Speed: all four, or none.
    const filled = SPEED_KEYS.filter((k) => !isBlank(v[k]));
    if (filled.length > 0 && filled.length < SPEED_KEYS.length) {
      for (const k of SPEED_KEYS) {
        if (isBlank(v[k])) {
          ctx.addIssue({
            code: "custom",
            path: [k],
            message: "Speed terms go together: fill all four, or clear them all",
          });
        }
      }
    }
    intField(ctx, ["speedRewardHours"], v.speedRewardHours, BOUNDS.speedHours, "Fast limit", " hours");
    intField(ctx, ["speedPenaltyHours"], v.speedPenaltyHours, BOUNDS.speedHours, "Slow limit", " hours");
    rupeeField(ctx, ["speedRewardRupees"], v.speedRewardRupees, BOUNDS.speedPaise, "Reward");
    rupeeField(ctx, ["speedPenaltyRupees"], v.speedPenaltyRupees, BOUNDS.speedPaise, "Penalty");
    const fast = wholeNumber(v.speedRewardHours);
    const slow = wholeNumber(v.speedPenaltyHours);
    if (fast !== null && slow !== null && slow < fast) {
      ctx.addIssue({
        code: "custom",
        path: ["speedPenaltyHours"],
        message: "The slow limit cannot be sooner than the fast limit",
      });
    }

    // Travel: each box independent, blank inherits.
    intField(ctx, ["travelFreeKm"], v.travelFreeKm, BOUNDS.travelFreeKm, "Free distance", " km");
    rupeeField(ctx, ["travelPerStepRupees"], v.travelPerStepRupees, BOUNDS.travelRatePaise, "Amount per step");
    rupeeField(ctx, ["travelMaxRupees"], v.travelMaxRupees, BOUNDS.travelMaxPaise, "Most per job");

    rupeeField(ctx, ["minRedeemableRupees"], v.minRedeemableRupees, BOUNDS.redeemPaise, "Minimum");
  });

/* --------------------------------------------------------------- form → wire */

const paiseOrNull = (s: string): number | null => (isBlank(s) ? null : rupeesToPaise(s));
const intOrNull = (s: string): number | null => (isBlank(s) ? null : wholeNumber(s));
const bandsOrNull = (vals: string[]): number[] | null =>
  vals.every(isBlank) ? null : vals.map((s) => rupeesToPaise(s) ?? 0);

/** Validated form → the whole PUT body. Call only on values the schema passed. */
export function toRulesBody(v: RulesFormValues): TechnicianRulesInput {
  return {
    payoutPercent: intOrNull(v.payoutPercent),
    cancelPenaltiesPaise: bandsOrNull(v.penalties),
    bonusBandsPaise: bandsOrNull(v.bonuses),
    speedRewardWithinHours: intOrNull(v.speedRewardHours),
    speedPenaltyAfterHours: intOrNull(v.speedPenaltyHours),
    speedRewardPaise: paiseOrNull(v.speedRewardRupees),
    speedPenaltyPaise: paiseOrNull(v.speedPenaltyRupees),
    travelFreeKm: intOrNull(v.travelFreeKm),
    travelPaisePerStep: paiseOrNull(v.travelPerStepRupees),
    travelMaxPaisePerJob: paiseOrNull(v.travelMaxRupees),
    minRedeemablePaise: paiseOrNull(v.minRedeemableRupees),
  };
}

/* ------------------------------------------------------------------ holding */

export const holdingSchema = z.object({
  amountRupees: z
    .string()
    .trim()
    .superRefine((s, ctx) => {
      const p = rupeesToPaise(s);
      if (p === null) {
        ctx.addIssue({ code: "custom", message: "Enter an amount in rupees, or 0 to release" });
      } else if (p > BOUNDS.redeemPaise[1]) {
        ctx.addIssue({ code: "custom", message: "That amount is too large" });
      }
    }),
  reason: z
    .string()
    .trim()
    .min(3, "Say why, so the trail makes sense later")
    .max(240, "Keep the reason under 240 characters"),
});

export type HoldingFormValues = z.infer<typeof holdingSchema>;
