import { useQuery } from "@tanstack/react-query";
import { getHighPriorityPendingCount } from "@/services/tickets";
import { ticketKeys } from "./useTickets";
import { BACKSTOP_REFETCH_MS } from "./liveness";

/**
 * How many high-priority tickets are still unassigned (E5) — the Tickets
 * rail badge, and nothing else. Same shape as `useApprovalsBadge` /
 * `useRedemptionsBadge`: its own count endpoint rather than a page of the
 * list, because the rail renders on every screen and "how many" is a TOTAL
 * a page of rows cannot answer.
 *
 * The count is already "until assigned" server-side — `technician_id IS
 * NULL` is part of what it counts — so nothing here has to track when it
 * should stop; it naturally reaches zero and the badge (gated on `badge ?`
 * in `Sidebar`) disappears with it.
 *
 * `enabled` gates it on `jobs.view`, the same feature the ticket list
 * itself requires, so somebody without it never polls a 403 for a badge
 * they cannot see.
 */
export function useTicketsBadge({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ticketKeys.highPriorityPendingCount(),
    queryFn: getHighPriorityPendingCount,
    staleTime: 30_000,
    // The socket keeps the board current, but says nothing about this total
    // directly — this is the floor under it, same reasoning as every other
    // rail badge's backstop poll.
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}
