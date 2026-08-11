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
   * Null until the technician changes it, and then it is THEIR edit.
   *
   * The daily cap is not ours to invent — it is set by whoever onboarded them
   * and arrives on the profile as `dailyJobCap`. Seeding this from mock data
   * showed every technician the same made-up number and told them they would
   * be offered more work than their manager allows. Read it with
   * `useBandwidthPerDay()`, which falls back to the real value.
   */
  bandwidthPerDay: number | null;
  timeOff: boolean;

  setOnline: (next: boolean) => void;
  toggleDay: (day: WeekdayKey) => void;
  setBandwidth: (next: number) => void;
  setTimeOff: (next: boolean) => void;
}

/** Prototype caps the daily job count at 1–12. */
export const BANDWIDTH_MIN = 1;
export const BANDWIDTH_MAX = 12;

export const useAvailabilityStore = create<AvailabilityState>((set) => ({
  online: true,
  days: { ...seed.days },
  bandwidthPerDay: null,
  timeOff: seed.timeOff,

  setOnline: (online) => set({ online }),
  toggleDay: (day) => set((s) => ({ days: { ...s.days, [day]: !s.days[day] } })),
  setBandwidth: (next) =>
    set({ bandwidthPerDay: Math.min(BANDWIDTH_MAX, Math.max(BANDWIDTH_MIN, next)) }),
  setTimeOff: (timeOff) => set({ timeOff }),
}));

/**
 * The cap to show: the technician's own edit if they made one, otherwise the
 * cap their manager set. Never a seeded constant.
 */
export function useBandwidthPerDay(): number | null {
  const edited = useAvailabilityStore((s) => s.bandwidthPerDay);
  const assigned = useSession((s) => s.technician?.dailyJobCap);
  return edited ?? assigned ?? null;
}
