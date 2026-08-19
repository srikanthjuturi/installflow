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

/** Today in IST, as `yyyy-mm-dd` — the `min` a date input needs. */
export function istToday(now: Date = new Date()): string {
  const { year, month, date } = istParts(now);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}
