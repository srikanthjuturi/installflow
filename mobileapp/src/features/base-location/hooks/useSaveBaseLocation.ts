import { useMutation, useQueryClient } from '@tanstack/react-query';

import { saveMyBaseLocation } from '@/features/base-location/api/baseLocation';
import { qk } from '@/lib/queryKeys';
import { useSession } from '@/store/session.store';
import type { BaseLocation, TechnicianSession } from '@/types/domain';

/**
 * Save the base, then put it where the rest of the app reads it.
 *
 * No query key of its own: the base lives on `me`, which Home's card and
 * Profile's row already read. It is written into that cache and into the
 * session store (the seed for the next cold start — `useMe`'s own pattern),
 * then `me` is refetched so the server has the last word.
 */
export function useSaveBaseLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveMyBaseLocation,
    onSuccess: (base: BaseLocation) => {
      queryClient.setQueryData<TechnicianSession>(qk.me(), (me) =>
        me ? { ...me, baseLocation: base } : me,
      );
      const current = useSession.getState().technician;
      if (current) useSession.getState().setTechnician({ ...current, baseLocation: base });
      void queryClient.invalidateQueries({ queryKey: qk.me() });
    },
  });
}
