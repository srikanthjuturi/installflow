import { useMutation, useQueryClient } from '@tanstack/react-query';

import { setUpiId } from '@/features/payout/api/payout';
import { useMe } from '@/features/profile/hooks/useMe';
import { qk } from '@/lib/queryKeys';
import { useSession } from '@/store/session.store';
import type { TechnicianSession } from '@/types/domain';

/**
 * The technician's own payout account, read from the profile the whole app
 * already shares. Server state, so Query rather than Zustand (hard rule 3) —
 * and reading it off `useMe` means Profile and this screen cannot disagree
 * about what is stored.
 *
 * `null` is a real, common answer: neither onboarding mode requires a UPI id,
 * so a new technician has none and the screen says so rather than guessing.
 */
export function useUpiId(): string | null {
  const { data } = useMe();
  return data?.upiId ?? null;
}

/**
 * Save or clear it.
 *
 * Optimistic, and mirroring `useSetDailyJobCap` deliberately — the same four
 * phases in the same order, because this is the same kind of write: one field
 * of the technician's own profile, saved from a screen that shows it.
 *
 * `onSuccess` writes back the SERVER's value rather than the one that was
 * typed, which matters more here than for a number: the server trims and
 * lowercases a VPA, so `Sunil@OKAXIS` is stored as `sunil@okaxis` and the
 * screen must show what is actually on file.
 *
 * `useSession.setTechnician` too, not only the query cache: the session store
 * is what seeds `useMe` on a cold start, so skipping it would show the old
 * value for the first frame after every relaunch.
 */
export function useSetUpiId() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setUpiId,

    onMutate: async (next: string | null) => {
      await queryClient.cancelQueries({ queryKey: qk.me() });
      const previous = queryClient.getQueryData<TechnicianSession>(qk.me());
      if (previous) {
        queryClient.setQueryData<TechnicianSession>(qk.me(), {
          ...previous,
          upiId: next,
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
      const current = queryClient.getQueryData<TechnicianSession>(qk.me());
      if (current) {
        const next = { ...current, upiId: result.upiId };
        queryClient.setQueryData<TechnicianSession>(qk.me(), next);
        useSession.getState().setTechnician(next);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.me() });
    },
  });
}
