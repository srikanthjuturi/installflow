/**
 * Grouping a time-ordered feed into calendar days.
 *
 * The reader's calendar, not the server's. A notification carries an instant;
 * whether that instant was "today" is a question only the browser can answer,
 * and answering it server-side would put a manager in Hyderabad and one in
 * Mumbai on different definitions of the same word.
 *
 * Sits beside `relativeTime`, which answers the other half of the same
 * question: the divider says WHICH DAY, the row says how long ago. Together
 * they cover a feed that spans a morning and one that spans a quarter.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** `2026-08-28` in local time — the identity a group is keyed and compared by. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "undated";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `Today` · `Tomorrow` · `Yesterday` · `Mon, 25 Aug` · `25 Aug 2025`.
 *
 * The weekday appears from the third day back, where it starts carrying
 * information — nobody needs telling that today is a Friday. The year appears
 * only outside the current one, for the same reason.
 *
 * `Tomorrow` is here for the escalation queue, which is the one list that
 * groups by a FUTURE instant: a confirmed slot rather than something that has
 * already happened. The notification feed and the ledger never reach it.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Undated";

  // Whole days apart, measured between midnights so an event at 11pm and one at
  // 1am are two days even though they are two hours. Rounded because a DST
  // shift makes the difference 23 or 25 hours rather than 24.
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";

  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export interface DayGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * Consecutive runs of the same day, in the order they arrived.
 *
 * Runs, not buckets: the feed is already sorted newest-first by the server, so
 * grouping neighbours preserves that order exactly. Collecting into a map keyed
 * by day would work today and quietly reorder the moment a page arrives out of
 * sequence.
 */
export function groupByDay<T>(
  items: T[],
  instant: (item: T) => string,
  now: Date = new Date()
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];

  for (const item of items) {
    const iso = instant(item);
    const key = dayKey(iso);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(iso, now), items: [item] });
  }

  return groups;
}
