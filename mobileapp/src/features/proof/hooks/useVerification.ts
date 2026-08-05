import { useMutation, useQuery } from '@tanstack/react-query';

import {
  getVerification,
  sendFeedbackLink,
  submitProof,
  type Verification,
} from '@/features/proof/api/verification';

export function useSubmitProof(jobId: string) {
  return useMutation({ mutationFn: () => submitProof(jobId) });
}

/**
 * Polls until the AI run resolves, then stops.
 *
 * `refetchInterval` returning false on a terminal status is what ends it —
 * without that the screen would keep hitting the endpoint forever once the
 * technician has already moved on.
 */
export function useVerification(verificationId: string | undefined, jobId: string, model: string) {
  return useQuery<Verification>({
    queryKey: ['verifications', verificationId],
    queryFn: () => getVerification(verificationId!, jobId, model),
    enabled: !!verificationId,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1200 : false),
  });
}

export function useSendFeedbackLink(jobId: string) {
  return useMutation({ mutationFn: () => sendFeedbackLink(jobId) });
}
