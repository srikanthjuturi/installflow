import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  claimRedemption,
  declineRedemption,
  getRedemption,
  listRedemptions,
  redemptionsToPayCount,
} from "@/services/redemptions";
import type { ListParams } from "@/types/api";
import { BACKSTOP_REFETCH_MS } from "./liveness";

export const redemptionKeys = {
  all: ["redemptions"] as const,
  list: (params: ListParams) => ["redemptions", "list", params] as const,
  count: () => ["redemptions", "count"] as const,
  detail: (id: string) => ["redemptions", "detail", id] as const,
};

/**
 * One page of the queue, server-paged — it is a queue you CLEAR, like
 * approvals, not an append-forever feed.
 */
export function useRedemptions(params: ListParams) {
  return useQuery({
    queryKey: redemptionKeys.list(params),
    queryFn: () => listRedemptions(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * How many are waiting to be paid. The rail badge, and nothing else — its own
 * endpoint for the reason `useApprovalsBadge` gives. `enabled` gates it on the
 * feature so an Area Manager does not fetch a 403 every two minutes.
 *
 * `notification.raised` invalidates it (see `useTicketStream`): a new request
 * rings the payer's bell, and the badge should move with it.
 */
export function useRedemptionsBadge({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: redemptionKeys.count(),
    queryFn: redemptionsToPayCount,
    staleTime: 30_000,
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/**
 * One redemption. `staleTime: 0` because the screenshot link inside it is
 * signed for fifteen minutes — the same reason `useTicketAttachments` gives.
 */
export function useRedemption(id: string) {
  return useQuery({
    queryKey: redemptionKeys.detail(id),
    queryFn: () => getRedemption(id),
    enabled: !!id,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

function useRedemptionWrite<TVars>(
  fn: (vars: TVars) => ReturnType<typeof getRedemption>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(redemptionKeys.detail(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: redemptionKeys.all });
    },
  });
}

export const useClaimRedemption = () =>
  useRedemptionWrite(claimRedemption, "Couldn't mark it as paid");

export const useDeclineRedemption = () =>
  useRedemptionWrite(declineRedemption, "Couldn't decline the redemption");
