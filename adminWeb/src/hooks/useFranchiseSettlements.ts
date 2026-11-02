import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  confirmSettlement,
  declineSettlement,
  getSettlementCount,
  getSettlementSummary,
  listSettlementFranchisees,
  listSettlements,
  recordSettlement,
} from "@/services/franchiseSettlements";
import type { ListParams } from "@/types/api";
import type {
  RecordSettlementInput,
  SettlementSide,
} from "@/types/franchiseSettlement";
import { BACKSTOP_REFETCH_MS } from "./liveness";

/** One prefix for the slice, so any write clears the list, the cards and the badge. */
export const settlementKeys = {
  all: ["franchise-settlements"] as const,
  list: (side: SettlementSide, params: ListParams) =>
    ["franchise-settlements", side, "list", params] as const,
  count: (side: SettlementSide) =>
    ["franchise-settlements", side, "count"] as const,
  summary: (side: SettlementSide, franchiseeId: string | null) =>
    ["franchise-settlements", side, "summary", franchiseeId] as const,
  franchisees: () => ["franchise-settlements", "staff", "franchisees"] as const,
};

export function useSettlements(side: SettlementSide, params: ListParams) {
  return useQuery({
    queryKey: settlementKeys.list(side, params),
    queryFn: () => listSettlements(side, params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** The rail badge: transfers waiting on this side. Gate `enabled` on the feature. */
export function useSettlementsBadge(
  side: SettlementSide,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: settlementKeys.count(side),
    queryFn: () => getSettlementCount(side),
    select: (c) => c.awaitingMe,
    staleTime: 30_000,
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useSettlementSummary(
  side: SettlementSide,
  franchiseeId: string | null
) {
  return useQuery({
    queryKey: settlementKeys.summary(side, franchiseeId),
    queryFn: () => getSettlementSummary(side, franchiseeId ?? undefined),
    staleTime: 10_000,
  });
}

export function useSettlementFranchisees({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: settlementKeys.franchisees(),
    queryFn: listSettlementFranchisees,
    staleTime: 5 * 60_000,
    enabled,
  });
}

function useSettlementWrite<TVars>(
  fn: (vars: TVars) => ReturnType<typeof confirmSettlement>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settlementKeys.all });
    },
  });
}

export const useRecordSettlement = (side: SettlementSide) =>
  useSettlementWrite(
    (input: RecordSettlementInput) => recordSettlement(side, input),
    "Couldn't record the transfer"
  );

export const useConfirmSettlement = (side: SettlementSide) =>
  useSettlementWrite(
    (id: string) => confirmSettlement(side, id),
    "Couldn't confirm the transfer"
  );

export const useDeclineSettlement = (side: SettlementSide) =>
  useSettlementWrite(
    (input: { id: string; reason: string }) => declineSettlement(side, input),
    "Couldn't decline the transfer"
  );
