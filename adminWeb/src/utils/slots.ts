/**
 * The windows a ticket can be served in — the browser's copy of the API's
 * `offered_slots`.
 *
 * It has to be expressed twice, for the same reason `_sla_order_case` mirrors
 * `sla_state` on the server: the list has to exist BEFORE the ticket does, so
 * there is no row to ask the API about. A vendor filling in the create form has
 * not created anything yet.
 *
 * The server is still the authority — `check_slot_bookable` re-derives this
 * list at commit time and refuses anything not on it. This copy exists so the
 * refusal is rare: a picker that only offers real windows beats a 400 arriving
 * after the form was filled in.
 *
 * It now also mirrors `manual_slot_allowed` (`api/app/core/slots.py`) — the
 * server's rule for a vendor-typed, off-grid window that stands in for one of
 * `SLOT_WINDOWS`. Same reasoning, same five constants: a refusal the vendor
 * only discovers after submitting is worse than one the form catches while
 * they are still typing.
 *
 * Keep in step with `api/app/core/tickets.py` and `offered_slots` in
 * `api/app/features/tickets/service.py`. The four constants below are that
 * file's, value for value.
 */

import { formatTimeRange } from "@/utils/datetime";

/** Two-hour windows, 5 AM to 9 PM local. `SLOT_WINDOWS`. */
const SLOT_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [5, 7],
  [7, 9],
  [9, 11],
  [11, 13],
  [13, 15],
  [15, 17],
  [17, 19],
  [19, 21],
];

/** Nobody can be dispatched to an address in ten minutes. `SLOT_LEAD_MINUTES`. */
const SLOT_LEAD_MINUTES = 90;

/**
 * Half the grid's own two hours — a manual window still has to be a visit,
 * not a five-minute "slot" a free pick would otherwise allow.
 * `MANUAL_SLOT_MIN_MINUTES`, `api/app/core/tickets.py`.
 */
const MANUAL_SLOT_MIN_MINUTES = 60;

/** IST, UTC+05:30. `SLOT_TIMEZONE_OFFSET_MINUTES`. */
const IST_OFFSET_MINUTES = 330;

/** How far ahead to walk. The server walks four days; so does this. */
const DAYS_AHEAD = 4;

export interface OfferedSlot {
  /** ISO instant — exactly what the API expects for `slotStart`. */
  start: string;
  end: string;
  /** `Thu 21 Aug` — the day heading. */
  day: string;
  /** `9:00–11:00 AM` IST, the same rendering `when_label` produces. */
  time: string;
}

/** Wall-clock IST parts for an instant, without pulling in a date library. */
function istParts(at: Date) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
  };
}

/** The instant at which `hour` o'clock IST falls on that IST calendar day. */
function istInstant(
  parts: { year: number; month: number; date: number },
  hour: number,
  dayOffset: number
): Date {
  return new Date(
    Date.UTC(parts.year, parts.month, parts.date + dayOffset, hour) -
      IST_OFFSET_MINUTES * 60_000
  );
}

/** Minutes since IST midnight — the clock-time half of `istParts`, for
 *  comparing a manual window's ends against the grid's own working hours. */
function istMinuteOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

const DAY_FMT = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
});

/** The windows are defined in IST, so they are labelled in IST — wherever the
 *  browser happens to be. Everything else in the console renders in local
 *  time, which for this market is the same clock. */
const IST_ZONE = "Asia/Kolkata";

/**
 * Every window this ticket could be served in, soonest first.
 *
 * Bounded at both ends, and both bounds matter: not sooner than the lead time,
 * and not later than the service level's deadline — a window past that is one
 * the company has already promised not to offer.
 *
 * An empty array is a real answer, not a bug: a 12-hour ticket raised at 22:00
 * has nothing left, and the form has to say so rather than render an empty menu.
 */
export function offeredSlots(
  serviceLevelHours: number,
  now: Date = new Date()
): OfferedSlot[] {
  const earliest = new Date(now.getTime() + SLOT_LEAD_MINUTES * 60_000);
  const latest = new Date(now.getTime() + serviceLevelHours * 3_600_000);
  const from = istParts(earliest);

  const out: OfferedSlot[] = [];
  for (let offset = 0; offset < DAYS_AHEAD; offset++) {
    for (const [fromHour, toHour] of SLOT_WINDOWS) {
      const begins = istInstant(from, fromHour, offset);
      if (begins < earliest || begins > latest) continue;
      const ends = istInstant(from, toHour, offset);
      out.push({
        start: begins.toISOString(),
        end: ends.toISOString(),
        // `Wed 19 Aug`, matching the server's `when_label`. Intl puts a comma
        // after the weekday; the server does not, and the two labels sit beside
        // each other on the ticket page.
        day: DAY_FMT.format(begins).replace(",", ""),
        time: formatTimeRange(begins, ends, IST_ZONE),
      });
    }
  }
  return out;
}

/**
 * Whether a vendor-typed, off-grid window may stand in for one of
 * `SLOT_WINDOWS` — the browser's copy of `manual_slot_allowed`
 * (`api/app/core/slots.py`).
 *
 * `offeredSlots` above tries the exact grid first; this only runs for a
 * window that does NOT match it, which exists for a vendor whose customer
 * wants a specific hour the two-hour windows do not land on. Every rule
 * below is already one of the grid's OWN rules, applied to an arbitrary
 * window instead of a fixed one — nothing here is new policy, and nothing
 * here is a new bound: `SLOT_LEAD_MINUTES` and the `now`/`serviceLevelHours`
 * ceiling are the exact same two numbers `offeredSlots` bounds its own list
 * with, so a manual window can never be accepted here and refused there, or
 * the reverse.
 *
 *   * `end > start` — a hand-typed pair carries no such guarantee the way a
 *     grid pair does.
 *   * at least `MANUAL_SLOT_MIN_MINUTES` wide — half the grid's own two
 *     hours. A visit still needs enough time to actually be done.
 *   * `start` no sooner than `SLOT_LEAD_MINUTES` from `now` — the same
 *     dispatch lead `offeredSlots` applies to `begins`.
 *   * `end` no later than `now + serviceLevelHours` hours — the grid bounds
 *     only `begins`, because every one of its windows is a fixed two hours
 *     and bounding the start already bounds the finish. A manual window has
 *     no fixed width, so the bound has to apply to the WHOLE window.
 *   * both ends inside the grid's own working day — no earlier than
 *     `SLOT_WINDOWS[0][0]` and no later than `SLOT_WINDOWS.at(-1)[1]`, read
 *     off the table itself rather than restated as a second `5`/`21`, so a
 *     future change to the grid's span moves this with it.
 *   * `start` and `end` on the same IST calendar day — a manual window is
 *     still one visit, not one that runs past midnight into the next.
 *
 * Pure, same as `offeredSlots` beside it — called on every keystroke of the
 * "Set a specific time" inputs, not only at submit.
 */
export function manualSlotAllowed(
  start: Date,
  end: Date,
  serviceLevelHours: number,
  now: Date = new Date()
): boolean {
  if (end <= start) return false;
  if (end.getTime() - start.getTime() < MANUAL_SLOT_MIN_MINUTES * 60_000) {
    return false;
  }
  if (start.getTime() < now.getTime() + SLOT_LEAD_MINUTES * 60_000) {
    return false;
  }
  const latest = now.getTime() + serviceLevelHours * 3_600_000;
  if (end.getTime() > latest) return false;

  const startParts = istParts(start);
  const endParts = istParts(end);
  if (
    startParts.year !== endParts.year ||
    startParts.month !== endParts.month ||
    startParts.date !== endParts.date
  ) {
    return false;
  }

  const dayOpensMinute = SLOT_WINDOWS[0][0] * 60;
  const dayClosesMinute = SLOT_WINDOWS[SLOT_WINDOWS.length - 1][1] * 60;
  if (
    istMinuteOfDay(start) < dayOpensMinute ||
    istMinuteOfDay(end) > dayClosesMinute
  ) {
    return false;
  }

  return true;
}

/**
 * One window the SERVER offered, rendered the way this file renders its own.
 *
 * The reschedule picker cannot use `offeredSlots` above: that one mirrors the
 * intake rule and stops at the service level, which a ticket being re-slotted
 * has usually already blown — the browser would compute an empty list for
 * exactly the tickets the control exists for. It also cannot know what the
 * assigned technician is already booked for. So the API sends the windows and
 * this only dresses them, which keeps ONE rendering of "Wed 19 Aug" and
 * "9:00–11:00 AM" in the console rather than a second that drifts.
 */
export function describeSlot(startIso: string, endIso: string): OfferedSlot {
  const begins = new Date(startIso);
  const ends = new Date(endIso);
  return {
    start: startIso,
    end: endIso,
    day: DAY_FMT.format(begins).replace(",", ""),
    time: formatTimeRange(begins, ends, IST_ZONE),
  };
}

/** Today in IST, as `yyyy-mm-dd` — the `min` a date input needs. */
export function istToday(now: Date = new Date()): string {
  const { year, month, date } = istParts(now);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}
