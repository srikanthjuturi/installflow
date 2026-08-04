import { useQuery } from '@tanstack/react-query';

import { fetchInvite } from '@/features/onboarding/api/invite';
import { qk } from '@/lib/queryKeys';

/**
 * Invite details never change while the screen is open — the token is a
 * one-shot link — so this is cached indefinitely rather than refetched.
 */
export function useInvite(token: string) {
  return useQuery({
    queryKey: qk.invite(token),
    queryFn: () => fetchInvite(token),
    staleTime: Infinity,
  });
}
