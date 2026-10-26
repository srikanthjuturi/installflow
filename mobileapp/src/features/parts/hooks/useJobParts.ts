import { useQuery } from '@tanstack/react-query';

import { getJobParts } from '@/features/parts/api/parts';
import { qk } from '@/lib/queryKeys';

/**
 * The spare-part requests on one of my jobs, and what may be asked for.
 *
 * `enabled` is "the job has been started": before then there is nothing to show
 * and nothing to ask. NOT polled — the socket's `job.changed` and every `job`
 * push invalidate `['jobs', id]`, which this key sits under, so a facility
 * decision lands without a timer; `refetchOnWindowFocus` covers a dead socket
 * on return to the app.
 */
export function useJobParts(jobId: string, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;

  return useQuery({
    queryKey: qk.jobParts(jobId),
    queryFn: () => getJobParts(jobId),
    enabled: !!jobId && enabled,
    refetchOnWindowFocus: true,
  });
}
