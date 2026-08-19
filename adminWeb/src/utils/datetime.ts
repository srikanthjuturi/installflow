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
