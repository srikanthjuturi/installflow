import { useEffect, useState } from 'react';

/** Noon and 5pm — where the words change in Indian English usage. */
const AFTERNOON_FROM = 12;
const EVENING_FROM = 17;

/**
 * Which part of the day it is. A period, not the greeting's words: the screen
 * words it at render, so a change of language rewords it without waiting for
 * the next boundary.
 */
export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export function dayPeriodAt(now: Date): DayPeriod {
  const hour = now.getHours();
  if (hour < AFTERNOON_FROM) return 'morning';
  if (hour < EVENING_FROM) return 'afternoon';
  return 'evening';
}

/** Milliseconds until the greeting would next change. */
function msUntilNextChange(now: Date): number {
  const hour = now.getHours();
  const next = new Date(now);
  // setHours(24) rolls over to midnight tomorrow, which is what we want.
  next.setHours(
    hour < AFTERNOON_FROM ? AFTERNOON_FROM : hour < EVENING_FROM ? EVENING_FROM : 24,
    0,
    0,
    0,
  );
  return next.getTime() - now.getTime();
}

/**
 * The part of the day, correct for the time and kept that way — what the Home
 * greeting is chosen by.
 *
 * The screen used to say "Good morning" at every hour. A technician doing an
 * evening install reads that as an app that is not paying attention — small,
 * but it is the first line on the first screen after signing in.
 *
 * Scheduled to fire exactly at the boundary rather than polled on an interval,
 * because this app is left open all day in the field: a one-minute timer would
 * wake the JS thread ~600 times a shift to change a string three times.
 */
export function useGreeting(): DayPeriod {
  const [period, setPeriod] = useState(() => dayPeriodAt(new Date()));

  useEffect(() => {
    const timer = setTimeout(
      () => setPeriod(dayPeriodAt(new Date())),
      // A second past the boundary, so the clock has definitely ticked over.
      msUntilNextChange(new Date()) + 1_000,
    );
    return () => clearTimeout(timer);
    // Re-runs after each change, which schedules the following boundary.
  }, [period]);

  return period;
}
