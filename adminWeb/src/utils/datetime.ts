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
 * The countdown to a slot, as a LABEL and a VALUE that agree with each other.
 *
 * The forward-facing twin of `lib/relativeTime`, and separate from it because
 * the two answer opposite questions: that one narrates the past ("4m ago") and
 * coarsens as it recedes, this one counts down to a promise and must stay
 * precise right up to it.
 *
 * ## Three states, because a slot is a WINDOW and not an instant
 *
 * The queue keeps a job in its live half until the window CLOSES — somebody can
 * still be sent while it is open — so a countdown that only measured to the
 * START read "Slot passed" for the entire two hours the customer was actually
 * sitting at home waiting. The most urgent row on the screen looked like a dead
 * one.
 *
 * This returned only a string at first, and that was the second half of the
 * same mistake. The string changed tense across the three states — `2h 40m`,
 * then `58m left`, then `Slot passed` — while the heading above it stayed the
 * fixed words "Time to slot". So a job whose window had opened read "TIME TO
 * SLOT / 58m left", which is a contradiction: you are IN the slot, and 58m is
 * what remains of it, not what remains before it. Side by side in a list, one
 * card carrying a trailing word its neighbours did not also looked like a bug
 * rather than a different state.
 *
 * Moving the tense into the label fixes both. The value is then a bare span in
 * every state, so the figures line up down the page and mean the same kind of
 * thing, and the words above say which question the figure answers.
 *
 *   before it opens   `TIME TO SLOT` · `2h 40m`   until somebody must be there
 *   while it is open  `SLOT ENDS IN` · `58m`      what is left of the window
 *   after it closes   `SLOT CLOSED`  · `1h 20m ago`
 *
 * The last one is deliberately not "Slot passed". The missed list only grows
 * and nothing clears it, so *how long ago* is the one thing separating a job
 * somebody could still ring the customer about from one three weeks cold.
 */
export interface Countdown {
  label: string;
  value: string;
  /** `open` and `closed` are what a caller tones differently. */
  state: "before" | "open" | "closed" | "unknown";
}

export function slotCountdown(
  start: string | null | undefined,
  end?: string | null,
  now: Date = new Date()
): Countdown {
  if (!start) return { label: "Time to slot", value: EMPTY, state: "unknown" };
  const opens = new Date(start);
  if (Number.isNaN(opens.getTime()))
    return { label: "Time to slot", value: EMPTY, state: "unknown" };

  const toOpen = Math.floor((opens.getTime() - now.getTime()) / 60_000);
  if (toOpen >= 0)
    return { label: "Time to slot", value: span(toOpen), state: "before" };

  const closes = end ? new Date(end) : null;
  if (closes && !Number.isNaN(closes.getTime())) {
    const left = Math.floor((closes.getTime() - now.getTime()) / 60_000);
    if (left >= 0)
      return { label: "Slot ends in", value: span(left), state: "open" };
    return { label: "Slot closed", value: `${coarse(-left)} ago`, state: "closed" };
  }
  // No end recorded, and the start is behind us. Nothing can be said about a
  // window whose length is unknown beyond the fact that it began.
  return {
    label: "Slot started",
    value: `${coarse(-toOpen)} ago`,
    state: "closed",
  };
}

/**
 * `2h 59m`, or `45m` under the hour. The PRECISE form, for a slot ahead.
 *
 * Precision earns its place in front of the slot and only there: the difference
 * between 40 minutes and 10 is whether anybody can still get there.
 */
function span(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  // `40m`, not `4m`, past the first hour: `2h 4m` and `2h 40m` are eight
  // minutes apart at a glance in a column of monospaced figures.
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * `45m` · `22h` · `3d` · `5w`. The COARSE form, for a slot already closed.
 *
 * `span` kept counting in hours for ever, and the missed queue is where that
 * fell over: a job whose slot closed last month rendered `814h 03m ago`, which
 * is eleven characters of monospace nobody can read as "about five weeks" and
 * which wrapped onto a second line in a fixed-width column.
 *
 * Nothing downstream of a closed slot needs the minutes. What a manager is
 * deciding is whether this is a customer to ring now or a fortnight of history,
 * and one significant figure answers that better than two exact ones.
 *
 * Weeks are the last unit on purpose. An escalation still sitting here after a
 * year is a data problem, and `52w ago` says so more usefully than `1y ago`.
 */
function coarse(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
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
