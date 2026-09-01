/**
 * Formatting for the instants the API returns.
 *
 * The mock stored pre-formatted display strings — `"Aug 4, 08:12"`, `"Aug 5,
 * 10:00–12:00"` — so nothing in the console ever parsed a date. Real responses
 * carry ISO instants, which have to be rendered somewhere, and rendering them
 * in one place is what stops six screens disagreeing about how a slot reads.
 *
 * `en-IN` throughout, and the dash between slot times is an en dash (–), which
 * is what the approved prototype uses.
 *
 * ## Times are 12-hour
 *
 * `4:00 PM`, not `16:00` — the house style, taken from the approved prototypes
 * rather than invented: the technician app's design reads `4:00 PM` and
 * `7:00 PM`, and its job data reads `2:00–4:00 PM` and `10 AM–12 PM`. Three
 * details come from those strings and are worth keeping deliberate:
 *
 *   * **no leading zero** — `9:00 AM`, never `09:00 AM`;
 *   * **upper case** — `en-IN` renders `pm`, and every approved string is `PM`;
 *   * **one meridiem for a range that stays inside it** — `2:00–4:00 PM`, but
 *     `10:00 AM–12:00 PM` when it crosses noon.
 */

/** Nothing recorded. The em dash the tables already draw for an absent value. */
export const EMPTY = "—";

/** `5 Aug` — a date with no year, for things inside the current cycle. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Formatters are cached per timezone: constructing an `Intl.DateTimeFormat` is
 * the expensive part, and a table of fifty rows formats a hundred times.
 */
const CLOCKS = new Map<string, Intl.DateTimeFormat>();
function clockFor(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let f = CLOCKS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(timeZone ? { timeZone } : {}),
    });
    CLOCKS.set(key, f);
  }
  return f;
}

/**
 * `5:02` and `PM` separately, so a range can print one meridiem for both ends.
 *
 * `formatToParts` rather than a regex over the formatted string: ICU renders
 * the day period as `pm`, `PM` or `p.m.` depending on the runtime's data, and
 * only the parts API says reliably which piece it is.
 */
function clock(d: Date, timeZone?: string): { hm: string; meridiem: string } {
  const parts = clockFor(timeZone).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    hm: `${get("hour")}:${get("minute")}`,
    meridiem: get("dayPeriod").replace(/\./g, "").toUpperCase(),
  };
}

/** `5:02 PM`. `timeZone` for the slot windows, which are defined in IST. */
export function formatTimeOfDay(d: Date, timeZone?: string): string {
  const c = clock(d, timeZone);
  return `${c.hm} ${c.meridiem}`;
}

/**
 * `2:00–4:00 PM`, or `10:00 AM–12:00 PM` when the range crosses noon.
 *
 * Both forms are the approved prototype's own — a range that stays inside one
 * half of the day says it once.
 */
export function formatTimeRange(from: Date, to: Date, timeZone?: string): string {
  const a = clock(from, timeZone);
  const b = clock(to, timeZone);
  return a.meridiem === b.meridiem
    ? `${a.hm}–${b.hm} ${b.meridiem}`
    : `${a.hm} ${a.meridiem}–${b.hm} ${b.meridiem}`;
}

/** `4 Aug, 8:12 AM` — a date and a time, for created/updated stamps. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  return `${formatDate(iso)}, ${formatTimeOfDay(d)}`;
}

/**
 * `5 Aug, 10:00 AM–12:00 PM`, or the em dash when no slot is agreed yet.
 *
 * A slot that somehow spans midnight prints both dates rather than pretending
 * it does not — rare, but silently wrong is worse than briefly ugly.
 */
export function formatSlot(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start || !end) return EMPTY;
  const from = new Date(start);
  const to = new Date(end);
  const sameDay = from.toDateString() === to.toDateString();
  return sameDay
    ? `${formatDate(start)}, ${formatTimeRange(from, to)}`
    : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/**
 * `2h 40m` until an instant — the escalation queue's countdown.
 *
 * The forward-facing twin of `lib/relativeTime`, and separate from it because
 * the two answer opposite questions: that one narrates the past ("4m ago") and
 * coarsens as it recedes, this one counts down to a promise and must stay
 * precise right up to it. Merging them would give one function two tenses.
 *
 * ## Three states, because a slot is a WINDOW and not an instant
 *
 * Pass `end` and the middle one appears. It has to: the queue keeps a job in
 * its live half until the window CLOSES — somebody can still be sent while it
 * is open — so counting only to the start meant a card sitting in the live
 * queue reading "Slot passed" for the entire two hours the customer was
 * actually waiting. The most urgent row on the screen looked like a dead one.
 *
 *   before it opens   `2h 59m`      how long until somebody must be there
 *   while it is open  `1h 10m left` how much of the window remains
 *   after it closes   `Slot passed` nobody went
 */
export function timeUntil(
  iso: string | null | undefined,
  /** The slot's END. Omit it and the middle state cannot appear. */
  end?: string | null,
  now: Date = new Date()
): string {
  if (!iso) return EMPTY;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return EMPTY;

  const minutes = Math.floor((then.getTime() - now.getTime()) / 60_000);
  if (minutes >= 0) return span(minutes);

  // The window has opened. How much of it is left is the number that matters
  // now — the customer is already at home waiting.
  const closes = end ? new Date(end) : null;
  if (closes && !Number.isNaN(closes.getTime())) {
    const left = Math.floor((closes.getTime() - now.getTime()) / 60_000);
    if (left >= 0) return `${span(left)} left`;
  }
  return "Slot passed";
}

/** `2h 59m`, or `45m` under the hour. */
function span(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  // `40m`, not `4m`, past the first hour: `2h 4m` and `2h 40m` are eight
  // minutes apart at a glance in a column of monospaced figures.
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time, not the `Z`-suffixed
 * instant an API returns. Used to seed a slot field when editing.
 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
