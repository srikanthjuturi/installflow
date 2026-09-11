import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  getPayoutAccount,
  requestUpiChange,
  sendPayoutCode,
  verifyPayoutAccount,
  withdrawUpiChange,
  type PayoutAccount,
} from '@/features/payout/api/payout';
import { qk } from '@/lib/queryKeys';
import { useSession } from '@/store/session.store';
import type { TechnicianSession } from '@/types/domain';

/**
 * The UPI ID on file, its name, and the latest change request.
 *
 * Under `qk.me()`'s prefix, so everything that already refreshes the profile —
 * a `upi_change` push above all, which is how a manager's decision arrives —
 * refreshes this too.
 */
export function usePayoutAccount() {
  return useQuery({
    queryKey: qk.payoutAccount(),
    queryFn: getPayoutAccount,
    refetchOnWindowFocus: true,
  });
}

/**
 * Put a saved account where the rest of the app reads it: this screen's
 * query, the profile the Profile row shows, and the session store that seeds
 * that profile on a cold start (skipping it would show the old value for the
 * first frame after every relaunch). The redeem card reads the UPI ID too.
 */
function writeBack(queryClient: QueryClient, account: PayoutAccount) {
  queryClient.setQueryData<PayoutAccount>(qk.payoutAccount(), account);
  const me = queryClient.getQueryData<TechnicianSession>(qk.me());
  if (me) {
    const next = { ...me, upiId: account.upiId, upiName: account.upiName };
    queryClient.setQueryData<TechnicianSession>(qk.me(), next);
    useSession.getState().setTechnician(next);
  }
  void queryClient.invalidateQueries({ queryKey: qk.redeemable() });
}

/** Step one of adding: a code to their own WhatsApp. */
export function useSendPayoutCode() {
  return useMutation({
    mutationFn: ({ upiId, upiName }: { upiId: string; upiName: string }) =>
      sendPayoutCode(upiId, upiName),
  });
}

/** Step two: check the code and save. */
export function useVerifyPayoutAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ upiId, upiName, code }: { upiId: string; upiName: string; code: string }) =>
      verifyPayoutAccount(upiId, upiName, code),
    onSuccess: (account) => writeBack(queryClient, account),
  });
}

/** Ask the manager for their area to change it. */
export function useRequestUpiChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ upiId, upiName }: { upiId: string; upiName: string }) =>
      requestUpiChange(upiId, upiName),
    onSuccess: (account) => queryClient.setQueryData(qk.payoutAccount(), account),
  });
}

/** Take a pending change back. */
export function useWithdrawUpiChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: withdrawUpiChange,
    onSuccess: (account) => queryClient.setQueryData(qk.payoutAccount(), account),
  });
}
