import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getRescheduleSlots,
  rescheduleJob,
  sendRescheduleCode,
} from '@/features/jobs/api/reschedule';
import { qk } from '@/lib/queryKeys';

/**
 * The windows this job could move into.
 *
 * `staleTime: 0`, for `useCancellationPreview`'s reason turned around: windows
 * fall out of the list as they approach — nothing can be booked inside 90
 * minutes — so a screen left open must refetch rather than offer a time the
 * server will refuse. Either way the server re-derives the list on submit; this
 * only decides whether the technician was shown a truthful set first.
 */
export function useRescheduleSlots(jobId: string) {
  return useQuery({
    queryKey: qk.rescheduleSlots(jobId),
    queryFn: () => getRescheduleSlots(jobId),
    enabled: !!jobId,
    staleTime: 0,
  });
}

/**
 * Ask the server to WhatsApp the customer a code for ONE window.
 *
 * Deliberately no `onSuccess` invalidation: nothing about the job has changed
 * yet. A code has been sent, which is a fact about a phone rather than about a
 * ticket.
 */
export function useSendRescheduleCode(jobId: string) {
  return useMutation({
    mutationFn: (startIso: string) => sendRescheduleCode(jobId, startIso),
  });
}

/**
 * Move the slot.
 *
 * Invalidates `['jobs']` wholesale rather than naming lists. The moved job
 * leaves one day's list and joins another's, Home's "today" set gains or loses
 * it, and the cancellation band is priced off the slot — so the prefix is the
 * honest blast radius and `['jobs', jobId]` alone would leave two screens
 * stale.
 *
 * Earnings are NOT invalidated, and their absence is the point: rescheduling
 * costs nothing. That is the entire difference from `useCancelJob`, which sits
 * beside this file and does invalidate them.
 */
export function useRescheduleJob(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: { startIso: string; code: string; note?: string }) =>
      rescheduleJob(jobId, vars.startIso, vars.code, vars.note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
