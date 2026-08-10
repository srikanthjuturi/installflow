import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AI_CONFIDENCE_THRESHOLD,
  approveMatch,
  getAiFlag,
  listAiFlagReasons,
  listAiFlags,
  rejectAndRetake,
} from "@/services/ai";
import { dashboardKeys } from "./useDashboard";
import { useRulesConfig } from "./useSettings";
import { ticketKeys } from "./useTickets";
import type { ListParams } from "@/types/api";

/** Re-exported so screens never import a service directly. */
export { AI_CONFIDENCE_THRESHOLD };

/**
 * The threshold this queue judges against.
 *
 * Reads the CONFIGURED value from rules, not the compile-time default —
 * otherwise moving the slider on /settings/rules would change that screen and
 * leave this one still claiming 70%. The constant is only the fallback for
 * the first render before rules resolve.
 */
export function useAiThreshold(): number {
  const { data } = useRulesConfig();
  return data?.ai.threshold ?? AI_CONFIDENCE_THRESHOLD;
}

export const aiKeys = {
  all: ["ai-review"] as const,
  list: (params: ListParams) => ["ai-review", "list", params] as const,
  reasons: () => ["ai-review", "reasons"] as const,
  detail: (id: string) => ["ai-review", "detail", id] as const,
};

/**
 * Time-sensitive: an unreadable image has to reach the technician before they
 * leave the customer's home, so this refetches as eagerly as the escalation
 * queue rather than on the ordinary list cadence.
 *
 * That eagerness and `keepPreviousData` have to coexist. Paging or filtering
 * keeps the current rows up while the next page resolves; a refocus refetch
 * then replaces them in place. It is safe because the server returns a total
 * order — equal-confidence rows tie-break on ticket id — so a background
 * refetch redraws the same rows in the same seats rather than reshuffling
 * them under a manager who is halfway to clicking Review.
 */
export function useAiQueue(params: ListParams = {}) {
  return useQuery({
    queryKey: aiKeys.list(params),
    queryFn: () => listAiFlags(params),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

/** Filter options, faceted server-side across the whole queue, not one page. */
export function useAiFlagReasons() {
  return useQuery({
    queryKey: aiKeys.reasons(),
    queryFn: listAiFlagReasons,
    // Same cadence as the queue — a ruling can retire the last row of a reason.
    staleTime: 10_000,
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
function useAiDecision<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiKeys.all });
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export const useApproveMatch = () =>
  useAiDecision(approveMatch, "Couldn't approve the match");
export const useRejectAndRetake = () =>
  useAiDecision(rejectAndRetake, "Couldn't reject the proof");
