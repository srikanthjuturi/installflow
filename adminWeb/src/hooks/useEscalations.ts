import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addBonusAndRenotify,
  assignTechnician,
  getEscalation,
  listEscalations,
} from "@/services/escalations";
import { dashboardKeys } from "./useDashboard";
import { ticketKeys } from "./useTickets";

export const escalationKeys = {
  all: ["escalations"] as const,
  list: () => ["escalations", "list"] as const,
  detail: (id: string) => ["escalations", "detail", id] as const,
};

/**
 * Time-sensitive: every row is counting down to a slot the customer was
 * promised, so this refetches far more eagerly than an ordinary list.
 */
export function useEscalations() {
  return useQuery({
    queryKey: escalationKeys.list(),
    queryFn: listEscalations,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useEscalation(id: string) {
  return useQuery({
    queryKey: escalationKeys.detail(id),
    queryFn: () => getEscalation(id),
    enabled: Boolean(id),
  });
}

function useEscalationMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: escalationKeys.all });
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export const useAddBonus = () => useEscalationMutation(addBonusAndRenotify);
export const useAssignTechnician = () => useEscalationMutation(assignTechnician);
