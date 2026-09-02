import { create } from 'zustand';

import type { EarningsWindow } from '@/types/domain';

/**
 * Which span the Earnings screen is reading over.
 *
 * Client state, not server state — it is a control's position, and what it
 * SELECTS is a TanStack Query key, so hard rule 3 is satisfied: no money lives
 * here, only the question.
 *
 * It is in a store rather than in the screen because the date picker is a
 * route above it, exactly as the crop screen is a route above the profile step
 * that shows the photo. A modal that has to hand a value back to the screen
 * underneath needs somewhere to put it, and expo-router has no return value.
 *
 * Surviving a tab switch is the second reason and a welcome one: a technician
 * who picks last month, checks a job and comes back is still looking at last
 * month.
 *
 * In-memory, so a cold start is back to the week. That is the right default to
 * open on and not worth persisting.
 */
interface EarningsWindowState {
  window: EarningsWindow;
  setWindow: (next: EarningsWindow) => void;
}

export const useEarningsWindow = create<EarningsWindowState>((set) => ({
  window: { kind: 'period', period: 'week' },
  setWindow: (window) => set({ window }),
}));
