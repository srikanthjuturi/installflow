import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cancelJob, getCancellationPreview } from '@/features/jobs/api/cancel';
import { qk } from '@/lib/queryKeys';
import type { CancellationReason } from '@/types/domain';

/** The penalty shown before confirming. Never computed on the device. */
export function useCancellationPreview(jobId: string) {
  return useQuery({
    queryKey: qk.cancellationPreview(jobId),
    queryFn: () => getCancellationPreview(jobId),
    enabled: !!jobId,
  });
}

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
