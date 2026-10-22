/**
 * The Employee statements month picker — Task 09 §5.6.
 *
 * An IST calendar month, stated as `YYYY-MM` on the wire (the format
 * `GET /franchise/statements/{technicianId}?month=` reads) and "September 2026"
 * on screen. Nothing in the shared `utils/date.ts` speaks that shape, and
 * neither client will ever need it again, so the little vocabulary lives here.
 *
 * **Every month below is derived in IST** — the picker's edge cases sit
 * exactly at midnight, and the 31st of March at 23:00 IST is April 1st UTC —
 * so the offset is added before the date parts are read rather than trusting
 * the browser's zone. The backend's statements read the same zone; a mismatch
 * here would offer a month the server has no rows for.
 */

import { slug } from "@/utils/slug";

/** Milliseconds from UTC to IST — five and a half hours, half zones included. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** One picker option: the wire value, its label, and whether the month is open. */
export interface StatementMonth {
  /** `2026-09` — what the `?month=` parameter carries. */
  value: string;
  /** `September 2026`, or `October 2026 (so far)` for the open month. */
  label: string;
  /**
   * The month has not closed yet — the figure can only grow and payroll runs
   * after a month, which is why the picker defaults to the PREVIOUS one.
   */
  isCurrent: boolean;
}

/** `now`'s IST parts, as people count months: 1–12, not a 0-based index. */
function istParts(now: Date): { year: number; month: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

function toMonth(parts: { year: number; month: number }, isCurrent: boolean): StatementMonth {
  const value = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  const label = `${MONTH_NAMES[parts.month - 1]} ${parts.year}${isCurrent ? " (so far)" : ""}`;
  return { value, label, isCurrent };
}

/** `now`'s previous IST month — the month payroll works on. The default. */
export function defaultStatementMonth(now: Date = new Date()): StatementMonth {
  const { year, month } = istParts(now);
  return toMonth(
    month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    false
  );
}

/**
 * The picker's options: the last `count` IST calendar months, newest first —
 * the open month at the top with "(so far)", then the closed ones. Twelve is
 * the default because a statement older than a year is payroll's problem to
 * archive, not this picker's to offer.
 */
export function statementMonths(now: Date = new Date(), count = 12): StatementMonth[] {
  const months: StatementMonth[] = [];
  let { year, month } = istParts(now);
  for (let i = 0; i < count; i++) {
    months.push(toMonth({ year, month }, i === 0));
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/**
 * Does `value` carry a well-formed `?month=` statement month. Shape and range
 * only — it is a URL parameter anyone can edit, so `2026-13` and the empty
 * string both answer false, and the picker falls back to
 * `defaultStatementMonth` on either.
 */
export function isStatementMonth(value: string | null | undefined): value is string {
  return /^(\d{4})-(0[1-9]|1[0-2])$/.test(value ?? "");
}

/**
 * What a downloaded statement names itself.
 *
 * The server's `Content-Disposition` is not CORS-exposed, so the browser uses
 * whatever the caller names the blob — and that name is the console's: the
 * company, the franchisee, the technician's code and the month, in the shape
 * the mock shows: `acme-appliances-skyfix-services-tch-4033-2026-09.csv`.
 * (`utils/slug.ts`'s `slug` — the same rule the ledger CSV name uses.)
 */
export function statementFileName(input: {
  company: string;
  franchisee: string;
  code: string;
  month: string;
}): string {
  return `${[slug(input.company), slug(input.franchisee), slug(input.code), slug(input.month)].join("-")}.csv`;
}