import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  confirmRecharge,
  getPlatformRecharge,
  getPlatformSettings,
  listPlatformRecharges,
  listWaitingRecharges,
  rejectRecharge,
  savePlatformSettings,
  waitingRechargeCount,
} from "@/services/platform";
import type { ListParams } from "@/types/api";
import { companyKeys } from "./useCompanies";

/**
 * How often the superadmin's badge and bell ask. Tighter than the ops console's
 * two-minute backstop, because here it is not a backstop — there is no socket
 * behind it, so this poll is the only way a waiting payment is heard of.
 */
const WAITING_POLL_MS = 30_000;

export const platformKeys = {
  all: ["platform"] as const,
  settings: () => ["platform", "settings"] as const,
  recharges: (params: ListParams) => ["platform", "recharges", "list", params] as const,
  waitingCount: () => ["platform", "recharges", "count"] as const,
  waiting: () => ["platform", "recharges", "waiting"] as const,
  recharge: (id: string) => ["platform", "recharges", "detail", id] as const,
};

export function usePlatformSettings() {
  return useQuery({
    queryKey: platformKeys.settings(),
    queryFn: getPlatformSettings,
    staleTime: 60_000,
  });
}

export function useSavePlatformSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't save the rules" },
    mutationFn: savePlatformSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(platformKeys.settings(), saved);
    },
  });
}

export function usePlatformRecharges(params: ListParams) {
  return useQuery({
    queryKey: platformKeys.recharges(params),
    queryFn: () => listPlatformRecharges(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * How many claims are waiting — the rail badge and the bell.
 *
 * POLLED, because the superadmin console has no socket: a superadmin holds no
 * company, and the live stream is per company. Focusing the tab refetches at
 * once.
 */
export function useWaitingRechargeCount() {
  return useQuery({
    queryKey: platformKeys.waitingCount(),
    queryFn: waitingRechargeCount,
    staleTime: 15_000,
    refetchInterval: WAITING_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** The bell's list — fetched only while the menu is open. */
export function useWaitingRecharges({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: platformKeys.waiting(),
    queryFn: listWaitingRecharges,
    staleTime: 10_000,
    enabled,
  });
}

/** `staleTime: 0` — the screenshot link inside is signed for fifteen minutes. */
export function usePlatformRecharge(id: string) {
  return useQuery({
    queryKey: platformKeys.recharge(id),
    queryFn: () => getPlatformRecharge(id),
    enabled: !!id,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

function useDecision<TVars>(
  fn: (vars: TVars) => ReturnType<typeof getPlatformRecharge>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (detail) => {
      queryClient.setQueryData(platformKeys.recharge(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: platformKeys.all });
      // A confirmation moves the company's balance on the Companies list.
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
  });
}

export const useConfirmRecharge = () =>
  useDecision(confirmRecharge, "Couldn't confirm the recharge");

export const useRejectRecharge = () =>
  useDecision(rejectRecharge, "Couldn't reject the recharge");
