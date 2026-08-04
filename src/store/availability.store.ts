import { create } from 'zustand';

import { availability as seed } from '@/mocks/db';
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
  bandwidthPerDay: number;
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
  bandwidthPerDay: seed.bandwidthPerDay,
  timeOff: seed.timeOff,

  setOnline: (online) => set({ online }),
  toggleDay: (day) => set((s) => ({ days: { ...s.days, [day]: !s.days[day] } })),
  setBandwidth: (next) =>
    set({ bandwidthPerDay: Math.min(BANDWIDTH_MAX, Math.max(BANDWIDTH_MIN, next)) }),
  setTimeOff: (timeOff) => set({ timeOff }),
}));
