/**
 * Calendar days, as `YYYY-MM-DD` strings reckoned in IST.
 *
 * A day here is a CIVIL date, never an instant, and that distinction is the
 * whole point of this file. This product counts by IST days everywhere — the
 * daily job cap by slot date, the penalty cap by IST calendar month, the
 * earnings window by `range_bounds` on the server. The moment a date becomes a
 * `Date` read in the device's own zone, a phone left on a foreign timezone
 * shows a different Tuesday from the one the server charged the penalty on.
 *
 * So: strings in, strings out, and every step of arithmetic through `Date.UTC`,
 * which has no local zone to slip on. Only `today()` consults a clock, and it
 * asks for IST explicitly.
 */

/** Mirrors `SLOT_TIMEZONE_OFFSET_MINUTES` in `api/app/core/tickets.py`. */
const IST_OFFSET_MINUTES = 330;

const MS_PER_DAY = 86_400_000;

/** Short month names. Static rather than `toLocaleDateString`, because
 *  formatting a civil date through a `Date` is the very trap above. */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Monday first — the week `period_bounds` runs, and the prototype's Mon–Sun. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const pad = (value: number) => String(value).padStart(2, '0');

/** `2026-09-02` → `[2026, 9, 2]`. Fixed-width slices, so the tuple is total. */
function parts(day: string): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
}

/** The civil date as the UTC instant standing for it. For arithmetic only. */
function toUtc(day: string): number {
  const [year, month, date] = parts(day);
  return Date.UTC(year, month - 1, date);
}

function fromUtc(ms: number): string {
  const at = new Date(ms);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/**
 * Today, in IST, whatever zone the phone is set to.
 *
 * Arithmetic rather than `Intl`, deliberately. Hermes ships a partial `Intl`
 * whose coverage differs between Android and iOS, and a calendar that cannot
 * work out what today is has no working control at all — not a fallback worth
 * betting the screen on.
 *
 * It needs no library anyway: IST is a fixed UTC+05:30 and India has observed
 * no daylight saving since 1945, which is the same fact
 * `SLOT_TIMEZONE_OFFSET_MINUTES` states on the server. Shift the instant by the
 * offset and read the UTC fields, and the answer is exact.
 */
export function today(): string {
  return fromUtc(Date.now() + IST_OFFSET_MINUTES * 60_000);
}

function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * MS_PER_DAY);
}

/** How many days a range covers, counting BOTH ends — 2 Sep to 2 Sep is 1. */
export function spanDays(from: string, to: string): number {
  return Math.abs(Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY)) + 1;
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Steps whole months from the 1st, so it can never land on a 31st that isn't. */
export function addMonths(day: string, count: number): string {
  const [year, month] = parts(day);
  const total = year * 12 + (month - 1) + count;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
}

/**
 * The days of `day`'s month laid out Monday-first, padded with nulls so every
 * row is seven cells. Rows, not a flat list, because that is how it is drawn.
 */
export function monthMatrix(day: string): (string | null)[][] {
  const first = startOfMonth(day);
  const firstUtc = toUtc(first);
  // getUTCDay() is 0 for Sunday; the grid starts on Monday.
  const lead = (new Date(firstUtc).getUTCDay() + 6) % 7;
  const length = spanDays(first, addDays(addMonths(first, 1), -1));

  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length }, (_, i) => addDays(first, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return Array.from({ length: cells.length / 7 }, (_, row) =>
    cells.slice(row * 7, row * 7 + 7),
  );
}

/** "September 2026" — the calendar's own heading. */
export function monthTitle(day: string): string {
  const [year, month] = parts(day);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** "2 Sep", or "2 Sep 2025" once the year stops being the obvious one. */
export function formatDay(day: string, { withYear = false } = {}): string {
  const [year, month, date] = parts(day);
  const short = `${date} ${MONTHS[month - 1]}`;
  return withYear ? `${short} ${year}` : short;
}

/**
 * "2 Sep" for one day, "12 Aug – 2 Sep" for a span.
 *
 * The year appears on both ends as soon as either falls outside the current
 * one, so a range that crosses New Year can never read as a three-week span.
 */
export function formatRange(from: string, to: string): string {
  const thisYear = today().slice(0, 4);
  const withYear = from.slice(0, 4) !== thisYear || to.slice(0, 4) !== thisYear;
  if (from === to) return formatDay(from, { withYear });
  return `${formatDay(from, { withYear })} – ${formatDay(to, { withYear })}`;
}
