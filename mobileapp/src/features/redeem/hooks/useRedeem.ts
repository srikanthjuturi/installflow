import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  confirmRedemption,
  getRedeemable,
  getRedemption,
  isRedeemRefused,
  listRedemptions,
  requestRedemption,
  type RedemptionDetail,
} from '@/features/redeem/api/redeem';
import { qk } from '@/lib/queryKeys';

/**
 * The redeem card's facts: what may be asked for, where it would go, what is open.
 *
 * `refetchOnWindowFocus` for the reason the Earnings queries carry it: the
 * moment somebody opens the app is when they want to know whether the money
 * came, and a payer's claim lands while the phone is in a pocket.
 */
export function useRedeemable() {
  return useQuery({
    queryKey: qk.redeemable(),
    queryFn: getRedeemable,
    refetchOnWindowFocus: true,
  });
}

export function useRedemptions() {
  return useQuery({
    queryKey: qk.redemptions(),
    queryFn: listRedemptions,
    refetchOnWindowFocus: true,
  });
}

/**
 * One redemption. `staleTime: 0` because the screenshot link inside it is
 * signed for fifteen minutes — a cached copy older than that renders a broken
 * image of the one thing the technician came here to check.
 */
export function useRedemption(id: string) {
  return useQuery({
    queryKey: qk.redemption(id),
    queryFn: () => getRedemption(id),
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * Ask to be paid. The detail it returns seeds the screen that opens next, so
 * the QR is on screen without a second round trip.
 *
 * A `BALANCE_CHANGED` refusal refetches the balance so the sheet can show the
 * new figure — the next tap then sends that one.
 */
export function useRequestRedemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestRedemption,
    onSuccess: (detail) => {
      queryClient.setQueryData<RedemptionDetail>(qk.redemption(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: qk.earnings() });
    },
    onError: (error) => {
      if (isRedeemRefused(error)) {
        void queryClient.invalidateQueries({ queryKey: qk.redeemable() });
      }
    },
  });
}

/** "I received it" / "Not yet". See `confirmRedemption`. */
export function useConfirmRedemption(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (received: boolean) => confirmRedemption(id, received),
    onSuccess: (detail) => {
      queryClient.setQueryData<RedemptionDetail>(qk.redemption(id), detail);
      // The card and the history both describe this one.
      void queryClient.invalidateQueries({ queryKey: qk.redeemable() });
      void queryClient.invalidateQueries({ queryKey: qk.redemptions() });
    },
  });
}
