import { useMutation, useQueryClient } from '@tanstack/react-query';

import { passJob } from '@/features/jobs/api/pass';
import { qk } from '@/lib/queryKeys';
import type { Job } from '@/types/domain';

/**
 * Pass on an offer, so it stops appearing in this technician's pool.
 *
 * Not optimistic, for the same reason accepting is not: the server is what
 * makes it stick. But once it has, the card is taken out of the cached pool
 * straight away rather than on the refetch — the technician lands back on the
 * list they passed from, and a card that is still there for a beat reads as
 * "the pass did not work".
 */
export function usePassJob(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => passJob(jobId),
    onSuccess: () => {
      queryClient.setQueryData<Job[]>(qk.pool(), (jobs) =>
        jobs?.filter((job) => job.id !== jobId),
      );
      queryClient.invalidateQueries({ queryKey: qk.pool(), exact: true });
    },
  });
}
