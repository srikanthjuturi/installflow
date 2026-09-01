import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cancelJob, getCancellationPreview } from '@/features/jobs/api/cancel';
import { qk } from '@/lib/queryKeys';
import type { CancellationReason } from '@/types/domain';

/**
 * The penalty shown before confirming. Never computed on the device — and now
 * that is true rather than aspirational: the band, the company's own amounts
 * and the monthly cap all come from `GET /jobs/:id/cancellation`.
 *
 * `staleTime: 0` on purpose. The band tightens as the slot approaches, so a
 * screen that has been open a while must refetch rather than confirm a price
 * that has moved. The charge is settled server-side either way; this only
 * decides whether the technician was shown the right figure first.
 */
export function useCancellationPreview(jobId: string) {
  return useQuery({
    queryKey: qk.cancellationPreview(jobId),
    queryFn: () => getCancellationPreview(jobId),
    enabled: !!jobId,
    staleTime: 0,
  });
}

/**
 * Cancelling moves money as well as the job, so it invalidates both.
 *
 * The pool card the job goes back onto is somebody else's screen; what this
 * technician's own app has to forget is the job list they no longer hold it
 * in, and the earnings the penalty has just come out of.
 */
export function useCancelJob(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reason: CancellationReason) => cancelJob(jobId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: qk.earningsSummary() });
      queryClient.invalidateQueries({ queryKey: qk.transactions() });
    },
  });
}
