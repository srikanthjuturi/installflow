import { useMutation, useQueryClient } from '@tanstack/react-query';

import { requestPart } from '@/features/parts/api/parts';
import type { PartRequestBody } from '@/features/parts/picker';
import { trackPartRequested } from '@/lib/analytics/events';
import { qk } from '@/lib/queryKeys';

/**
 * Raise a request. The response IS the updated parts list, so it seeds the
 * cache; the job's status moved (`In Progress → Awaiting Part`) so the job and
 * the lists that show it are refetched — `useCompleteJob`'s set.
 */
export function useRequestPart(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PartRequestBody) => requestPart(jobId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.jobParts(jobId), data);
      // `exact`: `['jobs', id]` is also the prefix of the parts key just seeded.
      void queryClient.invalidateQueries({ queryKey: qk.job(jobId), exact: true });
      void queryClient.invalidateQueries({ queryKey: ['jobs', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: [...qk.myJobs('all'), 'today'] });

      trackPartRequested(jobId);
    },
  });
}
