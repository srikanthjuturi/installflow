import { create } from 'zustand';

import { availability as seed } from '@/mocks/db';
import { useSession } from '@/store/session.store';
import type { WeekdayKey } from '@/types/domain';

/**
 * Client state only — the online toggle and the availability form.
 *
 * These live in Zustand rather than TanStack Query because the technician
 * flips them optimistically and expects the switch to move instantly; a
 * server round-trip in between would feel broken in poor coverage. Jobs,
 * profile and earnings stay in Query where they belong.
 */
interface AvailabilityState {
  online: boolean;
  days: Record<WeekdayKey, boolean>;
  /**
   * The technician's OWN edit of the daily cap. Three states, and all three
   * are different claims:
   *
   *   `undefined` — not edited; whatever their manager set still applies
   *   `null`      — edited to NO LIMIT
   *   a number    — edited to that cap
   *
   * The daily cap is not ours to invent. Seeding it from mock data once showed
   * every technician the same made-up number and told them they would be
   * offered more work than their manager allows. Read it with
   * `useBandwidthPerDay()`, which falls back to the real value.
   */
  bandwidthPerDay: number | null | undefined;
  timeOff: boolean;

  setOnline: (next: boolean) => void;
  toggleDay: (day: WeekdayKey) => void;
  /** `null` means no limit. */
  setBandwidth: (next: number | null) => void;
  setTimeOff: (next: boolean) => void;
}

/**
 * A cap of zero would mean "never offer me work", which is what going offline
 * says — so one is the floor. There is deliberately **no ceiling**: a
 * technician may take as many jobs a day as they are willing to, and the old
 * limit of twelve was a guess nobody could defend.
 */
export const BANDWIDTH_MIN = 1;

/** Where the stepper starts when somebody turns a limit on. */
export const BANDWIDTH_DEFAULT = 5;

export const useAvailabilityStore = create<AvailabilityState>((set) => ({
  online: true,
  days: { ...seed.days },
  bandwidthPerDay: undefined,
  timeOff: seed.timeOff,

  setOnline: (online) => set({ online }),
  toggleDay: (day) => set((s) => ({ days: { ...s.days, [day]: !s.days[day] } })),
  setBandwidth: (next) =>
    set({
      bandwidthPerDay: next === null ? null : Math.max(BANDWIDTH_MIN, next),
    }),
  setTimeOff: (timeOff) => set({ timeOff }),
}));

/**
 * The cap to show: the technician's own edit if they made one, otherwise the
 * cap their manager set, otherwise none. Never a seeded constant.
 *
 * `null` means NO LIMIT — which is what a newly onboarded technician has,
 * because neither the Add screen nor the joining flow asks for a cap any more.
 */
export function useBandwidthPerDay(): number | null {
  const edited = useAvailabilityStore((s) => s.bandwidthPerDay);
  const assigned = useSession((s) => s.technician?.dailyJobCap);
  // `undefined` means "not edited" and falls through; `null` is a real answer
  // and must NOT, or turning the limit off would silently restore the
  // manager's number.
  if (edited !== undefined) return edited;
  return assigned ?? null;
}
