import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AI_CONFIDENCE_THRESHOLD,
  approveMatch,
  getAiFlag,
  listAiFlags,
  rejectAndRetake,
} from "@/services/ai";
import { dashboardKeys } from "./useDashboard";
import { ticketKeys } from "./useTickets";

/** Re-exported so screens never import a service directly. */
export { AI_CONFIDENCE_THRESHOLD };

export const aiKeys = {
  all: ["ai-review"] as const,
  list: () => ["ai-review", "list"] as const,
  detail: (id: string) => ["ai-review", "detail", id] as const,
};

/**
 * Time-sensitive: an unreadable image has to reach the technician before they
 * leave the customer's home, so this refetches as eagerly as the escalation
 * queue rather than on the ordinary list cadence.
 */
export function useAiQueue() {
  return useQuery({
    queryKey: aiKeys.list(),
    queryFn: listAiFlags,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useAiFlag(id: string) {
  return useQuery({
    queryKey: aiKeys.detail(id),
    queryFn: () => getAiFlag(id),
    enabled: Boolean(id),
  });
}

/** Either ruling removes the ticket from the queue and moves it on. */
function useAiDecision<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiKeys.all });
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export const useApproveMatch = () => useAiDecision(approveMatch);
export const useRejectAndRetake = () => useAiDecision(rejectAndRetake);
