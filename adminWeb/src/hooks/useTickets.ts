import { useQuery } from "@tanstack/react-query";
import { getTicket, listTickets } from "@/services/tickets";
import type { TicketFilters } from "@/types";

/**
 * Query keys are tuples so a mutation can invalidate by prefix:
 * `queryClient.invalidateQueries({ queryKey: ticketKeys.all })`.
 */
export const ticketKeys = {
  all: ["tickets"] as const,
  list: (filters: TicketFilters) => ["tickets", "list", filters] as const,
  detail: (id: string) => ["tickets", "detail", id] as const,
};

export function useTickets(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: ticketKeys.list(filters),
    queryFn: () => listTickets(filters),
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: () => getTicket(id),
    enabled: Boolean(id),
  });
}
