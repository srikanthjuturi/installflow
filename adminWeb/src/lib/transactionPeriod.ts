/**
 * The date presets of the Transactions screens, in IST.
 *
 * Documents are cut on Indian calendar days (the server's `day_start` is IST
 * midnight), so "this month" has to be the month a person in India is in - a
 * browser in another zone would otherwise ask for the wrong boundary around
 * midnight on the 1st. The offset is added before the parts are read, the same
 * trick `components/franchise/statements.ts` uses.
 *
 * Pure: `now` is a parameter so the edges can be tested.
 */

export const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "last_3_months",
  "this_year",
  "custom",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  this_year: "This year",
  custom: "Custom",
};

export const DEFAULT_PRESET: PeriodPreset = "this_month";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface DateRange {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, inclusive. */
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** `now`'s IST calendar date: month is 1-12. */
function istParts(now: Date): { year: number; month: number; day: number } {
  const s = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
  };
}

/** Last day of a 1-based month. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today in IST as `YYYY-MM-DD`. */
export function istToday(now: Date = new Date()): string {
  const { year, month, day } = istParts(now);
  return ymd(year, month, day);
}

/** Shifts a 1-based (year, month) by `delta` months. */
function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * The range a preset stands for. `custom` has no range of its own - it returns
 * this month, which is only the starting point for the two date boxes.
 */
export function presetRange(
  preset: PeriodPreset,
  now: Date = new Date()
): DateRange {
  const { year, month, day } = istParts(now);
  const today = ymd(year, month, day);
  switch (preset) {
    case "last_month": {
      const p = shiftMonth(year, month, -1);
      return {
        from: ymd(p.year, p.month, 1),
        to: ymd(p.year, p.month, lastDay(p.year, p.month)),
      };
    }
    case "last_3_months": {
      // The two whole months before this one, and this month so far.
      const p = shiftMonth(year, month, -2);
      return { from: ymd(p.year, p.month, 1), to: today };
    }
    case "this_year":
      return { from: ymd(year, 1, 1), to: today };
    case "this_month":
    case "custom":
    default:
      return { from: ymd(year, month, 1), to: today };
  }
}

/** Is `value` a preset we know? Anything else in a pasted URL falls back. */
export function isPreset(value: string | null | undefined): value is PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(value ?? "");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (v: string | null | undefined): v is string =>
  Boolean(v) && ISO_DAY.test(v as string) && !Number.isNaN(Date.parse(v as string));

/** The server refuses a statement longer than this (three years). */
export const MAX_SPAN_DAYS = 3 * 366;

export function spanDays(range: DateRange): number {
  return Math.round(
    (Date.parse(range.to) - Date.parse(range.from)) / (24 * 60 * 60 * 1000)
  );
}

/** A reason a range cannot be asked for, or null. Mirrors BAD_PERIOD / PERIOD_TOO_LONG. */
export function rangeProblem(range: DateRange): string | null {
  if (!isIsoDay(range.from) || !isIsoDay(range.to)) return "Choose both dates.";
  if (range.to < range.from) return "The end date is before the start date.";
  if (spanDays(range) > MAX_SPAN_DAYS) return "Pick a period of three years or less.";
  return null;
}
