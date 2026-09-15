import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  cancelRecharge,
  claimRecharge,
  createRecharge,
  getCredits,
  getRecharge,
  listCreditEntries,
  listRecharges,
} from "@/services/credits";
import type { ListParams } from "@/types/api";

/**
 * One prefix for the whole slice, so a recharge decided by the superadmin —
 * which reaches this console only as a bell (`notification.raised`, see
 * `useTicketStream`) — refreshes the balance, the statement and the recharge
 * together.
 */
export const creditKeys = {
  all: ["credits"] as const,
  summary: () => ["credits", "summary"] as const,
  entries: (params: ListParams) => ["credits", "entries", params] as const,
  recharges: (params: ListParams) => ["credits", "recharges", params] as const,
  recharge: (id: string) => ["credits", "recharge", id] as const,
};

export function useCredits({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: creditKeys.summary(),
    queryFn: getCredits,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useCreditEntries(params: ListParams) {
  return useQuery({
    queryKey: creditKeys.entries(params),
    queryFn: () => listCreditEntries(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useRecharges(params: ListParams) {
  return useQuery({
    queryKey: creditKeys.recharges(params),
    queryFn: () => listRecharges(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/**
 * One recharge. `staleTime: 0` because the screenshot link inside it is signed
 * for fifteen minutes — the reason `useRedemption` gives.
 */
export function useRecharge(id: string) {
  return useQuery({
    queryKey: creditKeys.recharge(id),
    queryFn: () => getRecharge(id),
    enabled: !!id,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

function useRechargeWrite<TVars>(
  fn: (vars: TVars) => ReturnType<typeof getRecharge>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(creditKeys.recharge(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: creditKeys.all });
    },
  });
}

export const useCreateRecharge = () =>
  useRechargeWrite(createRecharge, "Couldn't start the recharge");

export const useClaimRecharge = () =>
  useRechargeWrite(claimRecharge, "Couldn't submit the payment");

export const useCancelRecharge = () =>
  useRechargeWrite(cancelRecharge, "Couldn't cancel the recharge");
