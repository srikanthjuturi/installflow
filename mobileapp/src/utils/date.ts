import { t } from 'i18next';

/**
 * Dates and times, reckoned in IST and written in the app's language.
 *
 * Two kinds of value come through here. A DAY is a civil date, a
 * `YYYY-MM-DD` string, never an instant — and that distinction is the point.
 * This product counts by IST days everywhere: the daily job cap by slot date,
 * the penalty cap by IST calendar month, the earnings window by
 * `range_bounds` on the server. The moment a date becomes a `Date` read in the
 * device's own zone, a phone left on a foreign timezone shows a different
 * Tuesday from the one the server charged the penalty on. An INSTANT (an ISO
 * string from the API) is read as the IST wall clock it stands for.
 *
 * So every step goes through `Date.UTC` arithmetic, which has no local zone to
 * slip on, and nothing here calls `Intl` or `toLocaleString`. Hermes ships a
 * partial `Intl` whose coverage differs between Android and iOS — the same
 * phrase came out as "Sep" on one phone and "Sept" on another — and its Indian
 * language data is thinner still. The words instead come from `dates` in the
 * locale files: month and weekday names, AM/PM, and the order the parts go in.
 *
 * Call these while rendering. A label built when data is fetched is cached in
 * that language, and stays in it after a switch.
 */

/** Mirrors `SLOT_TIMEZONE_OFFSET_MINUTES` in `api/app/core/tickets.py`. */
const IST_OFFSET_MINUTES = 330;

const MS_PER_DAY = 86_400_000;

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

// ── Names, in the app's language ────────────────────────────────────────────

/** `9` → "Sep". */
function monthShort(month: number): string {
  return t('dates.monthsShort', { returnObjects: true })[month - 1] ?? '';
}

/** `9` → "September". */
function monthLong(month: number): string {
  return t('dates.monthsLong', { returnObjects: true })[month - 1] ?? '';
}

/** `0` (Sunday, as `getUTCDay` counts) → "Sun". */
function weekdayShort(weekday: number): string {
  return t('dates.weekdaysShort', { returnObjects: true })[weekday] ?? '';
}

function weekdayLong(weekday: number): string {
  return t('dates.weekdaysLong', { returnObjects: true })[weekday] ?? '';
}

/** Monday first — the week `period_bounds` runs, and the prototype's Mon–Sun. */
export function weekdayInitials(): readonly string[] {
  return t('dates.weekdayInitials', { returnObjects: true });
}

// ── Civil days ──────────────────────────────────────────────────────────────

/**
 * Today, in IST, whatever zone the phone is set to.
 *
 * It needs no library: IST is a fixed UTC+05:30 and India has observed no
 * daylight saving since 1945, which is the same fact
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
  return t('dates.monthYear', { month: monthLong(month), year });
}

/** "2 Sep", or "2 Sep 2025" once the year stops being the obvious one. */
export function formatDay(day: string, { withYear = false } = {}): string {
  const [year, month, date] = parts(day);
  return withYear
    ? t('dates.dayMonthYear', { day: date, month: monthShort(month), year })
    : t('dates.dayMonth', { day: date, month: monthShort(month) });
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

/** "Mon–Sun": the week as the Earnings screen names it. */
export function weekSpanLabel(): string {
  return `${weekdayShort(1)}–${weekdayShort(0)}`;
}

// ── Instants, read on the IST wall clock ────────────────────────────────────

interface Clock {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** 0 is Sunday. */
  weekday: number;
  /** 0–23. */
  hour: number;
  minute: number;
}

/** What an IST clock showed at `iso`. Null for a string that is not a date. */
function istClock(iso: string): Clock | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const at = new Date(ms + IST_OFFSET_MINUTES * 60_000);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    weekday: at.getUTCDay(),
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
  };
}

/** The IST day an instant falls on, as a `YYYY-MM-DD` day. */
export function istDay(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : fromUtc(ms + IST_OFFSET_MINUTES * 60_000);
}

const hour12 = (hour: number) => (hour % 12 === 0 ? 12 : hour % 12);
const period = (hour: number) => (hour < 12 ? t('dates.am') : t('dates.pm'));

/** "2:00 PM". */
export function timeLabel(iso: string): string {
  const at = istClock(iso);
  if (!at) return '';
  return t('dates.time', { hour: hour12(at.hour), minute: pad(at.minute), period: period(at.hour) });
}

/** "2:00 PM–4:00 PM". */
export function timeRangeLabel(startIso: string, endIso: string): string {
  return `${timeLabel(startIso)}–${timeLabel(endIso)}`;
}

/**
 * "2–4 PM" for dense rows; "11 AM–1 PM" when the window crosses noon, where
 * one period at the end would make it read as 11 PM. Whole hours, as before:
 * a window is booked on the hour.
 */
export function hourRangeLabel(startIso: string, endIso: string): string {
  const from = istClock(startIso);
  const to = istClock(endIso);
  if (!from || !to) return '';
  if (period(from.hour) === period(to.hour)) {
    return t('dates.hourRange', {
      from: hour12(from.hour),
      to: hour12(to.hour),
      period: period(to.hour),
    });
  }
  const hour = (at: Clock) => t('dates.hour', { hour: hour12(at.hour), period: period(at.hour) });
  return `${hour(from)}–${hour(to)}`;
}

/** "21 Sep". */
export function dayMonthLabel(iso: string): string {
  const at = istClock(iso);
  return at ? t('dates.dayMonth', { day: at.day, month: monthShort(at.month) }) : '';
}

/** "Today", or "Tue, 22 Sep" — the heading a list of windows groups under. */
export function dayHeading(iso: string): string {
  if (istDay(iso) === today()) return t('dates.today');
  const at = istClock(iso);
  if (!at) return '';
  return t('dates.weekdayDayMonth', {
    weekday: weekdayShort(at.weekday),
    day: at.day,
    month: monthShort(at.month),
  });
}

/** "Monday, 21 Sep" — a day named in full. */
export function longDayLabel(iso: string): string {
  const at = istClock(iso);
  if (!at) return '';
  return t('dates.weekdayDayMonth', {
    weekday: weekdayLong(at.weekday),
    day: at.day,
    month: monthShort(at.month),
  });
}

/** "September 2026", for an instant. */
export function monthYearLabel(iso: string): string {
  const at = istClock(iso);
  return at ? t('dates.monthYear', { month: monthLong(at.month), year: at.year }) : '';
}

/** "Today · 2:00 PM–4:00 PM" — a whole slot, day and window. */
export function slotLabel(startIso: string, endIso: string): string {
  return `${dayHeading(startIso)} · ${timeRangeLabel(startIso, endIso)}`;
}

/** "12 Sep, 2:05 PM" — the moment somebody did something. */
export function momentLabel(iso: string): string {
  const day = dayMonthLabel(iso);
  return day ? `${day}, ${timeLabel(iso)}` : '';
}

/**
 * "Today", "Yesterday", or "5 Aug" — in the technician's own day, the way the
 * server's earnings rows name it (`_when` in `features/earnings/service.py`).
 */
export function relativeDayLabel(iso: string): string {
  const day = istDay(iso);
  const now = today();
  if (day === now) return t('dates.today');
  if (day === addDays(now, -1)) return t('dates.yesterday');
  return dayMonthLabel(iso);
}
