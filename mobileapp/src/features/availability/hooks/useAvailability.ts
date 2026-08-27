import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  setAcceptingWork,
  setDailyJobCap,
} from '@/features/availability/api/availability';
import { useMe } from '@/features/profile/hooks/useMe';
import { qk } from '@/lib/queryKeys';
import { useSession } from '@/store/session.store';
import type { TechnicianSession } from '@/types/domain';

/**
 * The Home toggle — "You're online · Receiving job offers".
 *
 * It reads and writes the SERVER's copy, which is the whole point of this file.
 * The switch used to be a `useState` in all but name: a Zustand field seeded to
 * `true`, so it forgot the technician's decision on every restart and nothing
 * outside the phone ever learned about it.
 *
 * It lives in Query rather than Zustand because it is now server state, and
 * hard rule 3 is explicit about that. What stays in Zustand is the rest of the
 * availability form, which is still local.
 */

/**
 * Whether this technician wants work right now.
 *
 * Defaults to `true` only while the profile is still loading — the same thing
 * the app has always shown on a cold start, and the safe direction: a
 * technician wrongly shown as online sees offers they can ignore, while one
 * wrongly shown as offline quietly stops being sent any.
 */
export function useAcceptingWork(): boolean {
  const { data } = useMe();
  return data?.acceptingWork ?? true;
}

export function useSetAcceptingWork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setAcceptingWork,

    // Optimistic, because a switch that waits for a round trip reads as broken
    // — and this one is flipped in the field, on the connection a field
    // technician actually has.
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: qk.me() });
      const previous = queryClient.getQueryData<TechnicianSession>(qk.me());
      if (previous) {
        queryClient.setQueryData<TechnicianSession>(qk.me(), {
          ...previous,
          acceptingWork: next,
        });
      }
      return { previous };
    },

    onError: (_error, _next, context) => {
      // Put the switch back where it was. Leaving it where the technician
      // dragged it would tell them they are offline while the server keeps
      // offering them work — the one outcome worse than the switch bouncing.
      if (context?.previous) {
        queryClient.setQueryData(qk.me(), context.previous);
      }
    },

    onSuccess: (result) => {
      // Keep the cold-start seed in step, or the next launch would open on the
      // old answer until `/technicians/me` came back.
      const current = queryClient.getQueryData<TechnicianSession>(qk.me());
      if (current) {
        useSession.getState().setTechnician({
          ...current,
          acceptingWork: result.acceptingWork,
        });
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.me() });
    },
  });
}

/**
 * The technician's own daily job cap. **Null means no limit**, which is what
 * every new technician has until they set one.
 *
 * `undefined` while the profile loads, so the screen can hold its shape instead
 * of flashing "no limit" at somebody who has one.
 */
export function useDailyJobCap(): number | null | undefined {
  const { data } = useMe();
  return data?.dailyJobCap;
}

/**
 * How many jobs are already held for TODAY, by the same rule the cap enforces.
 *
 * Deliberately NOT counted from `/jobs/today`: that list drops closed jobs, so
 * it would read lower than the number the server actually refuses on. A screen
 * saying "2 of 3" while an accept comes back "you have 3" is worse than showing
 * nothing at all.
 *
 * It rides on `/technicians/me` so the screen has it on first paint, rather
 * than only after a save.
 */
export function useJobsToday(): number | undefined {
  const { data } = useMe();
  return data?.jobsToday;
}

/**
 * Set or clear the cap.
 *
 * Optimistic for the same reason the toggle is: a stepper that waits for a
 * round trip per tap is unusable on a field connection. Rolled back on failure,
 * because leaving the number where they dragged it would tell a technician they
 * had raised their cap while the server kept refusing jobs at the old one.
 *
 * The value it writes was Zustand-only until this existed — set, then silently
 * lost on the next relaunch, with nothing on screen to explain it.
 */
export function useSetDailyJobCap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setDailyJobCap,

    onMutate: async (next: number | null) => {
      await queryClient.cancelQueries({ queryKey: qk.me() });
      const previous = queryClient.getQueryData<TechnicianSession>(qk.me());
      if (previous) {
        queryClient.setQueryData<TechnicianSession>(qk.me(), {
          ...previous,
          dailyJobCap: next,
        });
      }
      return { previous };
    },

    onError: (_error, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.me(), context.previous);
      }
    },

    onSuccess: (result) => {
      // Both values, not just the cap: the save is the one moment the server
      // recounts today, and dropping it would leave "2 of 3" stale next to a
      // number that just changed.
      const current = queryClient.getQueryData<TechnicianSession>(qk.me());
      if (current) {
        const next = {
          ...current,
          dailyJobCap: result.dailyJobCap,
          jobsToday: result.jobsToday,
        };
        queryClient.setQueryData<TechnicianSession>(qk.me(), next);
        useSession.getState().setTechnician(next);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.me() });
    },
  });
}
