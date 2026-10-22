import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import type { ListParams } from "@/types/api";
import type { RedemptionDetail } from "@/types/redemption";
import { BACKSTOP_REFETCH_MS } from "./liveness";

export const redemptionKeys = {
  all: ["redemptions"] as const,
  list: (params: ListParams) => ["redemptions", "list", params] as const,
  count: () => ["redemptions", "count"] as const,
  /** `franchiseeId` is part of the identity: whose pool the row was read in. */
  detail: (id: string, franchiseeId?: string | null) =>
    ["redemptions", "detail", id, franchiseeId ?? null] as const,
};

/**
 * One page of the queue, server-paged — it is a queue you CLEAR, like
 * approvals, not an append-forever feed.
 */
export function useRedemptions(params: ListParams) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: redemptionKeys.list(params),
    queryFn: () => api.redemptions.list(params),
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
  const { api } = useWorkspace();
  return useQuery({
    queryKey: redemptionKeys.count(),
    queryFn: api.redemptions.count,
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
export function useRedemption(id: string, franchiseeId?: string | null) {
  const { api, workspace } = useWorkspace();
  return useQuery({
    queryKey: redemptionKeys.detail(id, franchiseeId),
    queryFn: () =>
      api.redemptions.detail(
        id,
        // Only the staff payer names a pool here (§5.10's selector lives in the
        // query string); arriving with one in a franchise workspace would be a
        // caller bug, and the portal's own door refuses it anyway.
        workspace === "ops" ? franchiseeId ?? null : null
      ),
    enabled: !!id,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

function useRedemptionWrite<TVars>(
  fn: (vars: TVars) => Promise<RedemptionDetail>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (detail) => {
      // Only the home pool's row can be written (`canAct`), so the home/default
      // key is the one that ever needs priming; a non-home read refreshes
      // through the invalidation instead.
      queryClient.setQueryData(redemptionKeys.detail(detail.id, null), detail);
      void queryClient.invalidateQueries({ queryKey: redemptionKeys.all });
    },
  });
}

export const useClaimRedemption = () => {
  const { api } = useWorkspace();
  return useRedemptionWrite(
    (input: Parameters<typeof api.redemptions.claim>[0]) =>
      api.redemptions.claim(input),
    "Couldn't mark it as paid"
  );
};

export const useDeclineRedemption = () => {
  const { api } = useWorkspace();
  return useRedemptionWrite(
    (input: { id: string; reason: string }) => api.redemptions.decline(input),
    "Couldn't decline the redemption"
  );
};
