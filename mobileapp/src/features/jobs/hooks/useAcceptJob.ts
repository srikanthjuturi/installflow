import { useMutation, useQueryClient } from '@tanstack/react-query';

import { acceptJob, isJobTaken } from '@/features/jobs/api/accept';
import { trackJobAccepted, trackJobAcceptLostRace } from '@/lib/analytics/events';
import { qk } from '@/lib/queryKeys';

/**
 * Deliberately NOT optimistic.
 *
 * Optimistic updates are the usual reflex for a tap like this, but they're
 * wrong here: first-accept-wins means the server is the only authority on
 * whether the job is ours. Showing it as accepted and then snatching it back
 * is worse than a 400ms wait, especially when the technician may already be
 * planning their route around it.
 */
export function useAcceptJob(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => acceptJob(jobId),
    onSuccess: (job) => {
      // The accept response IS the job detail — same `JobOut` shape the detail
      // endpoint returns. Seeding it means the technician lands on a populated
      // screen instead of a spinner, and it removes the second round trip that
      // invalidating alone would have forced.
      queryClient.setQueryData(qk.job(jobId), job);

      queryClient.invalidateQueries({ queryKey: qk.pool() });
      queryClient.invalidateQueries({ queryKey: ['jobs', 'mine'] });

      trackJobAccepted(jobId);
    },
    onError: (error) => {
      // Whether it was taken or genuinely failed, the pool is now stale.
      queryClient.invalidateQueries({ queryKey: qk.pool() });

      // Losing the race is a normal outcome (doc §6), not an error worth GA's
      // conversion metric — PostHog only, as funnel-diagnostic detail.
      if (isJobTaken(error)) trackJobAcceptLostRace(jobId);
    },
  });
}
