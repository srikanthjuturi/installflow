import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createTicket,
  forceCloseTicket,
  getTicket,
  listTickets,
} from "@/services/tickets";
import { dashboardKeys } from "./useDashboard";
import type { ListParams } from "@/types/api";

/**
 * Query keys are tuples so a mutation can invalidate by prefix:
 * `queryClient.invalidateQueries({ queryKey: ticketKeys.all })`.
 *
 * The list key carries the WHOLE params object — page, size, sort, search and
 * filters each address a different server response, so each gets its own
 * cache entry.
 */
export const ticketKeys = {
  all: ["tickets"] as const,
  list: (params: ListParams) => ["tickets", "list", params] as const,
  detail: (id: string) => ["tickets", "detail", id] as const,
};

export function useTickets(params: ListParams = {}) {
  return useQuery({
    queryKey: ticketKeys.list(params),
    queryFn: () => listTickets(params),
    // Hold the page already on screen while the next one loads. Without this
    // every page change empties the table back to skeletons, which reads as
    // the data having gone away rather than as a step sideways.
    placeholderData: keepPreviousData,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: () => getTicket(id),
    enabled: Boolean(id),
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't create the ticket" },
    mutationFn: createTicket,
    onSuccess: () => {
      // Invalidate by prefix — every ticket list, whatever its filters,
      // plus the dashboard counts that summarise them.
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useForceCloseTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't force-close the ticket" },
    mutationFn: forceCloseTicket,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
