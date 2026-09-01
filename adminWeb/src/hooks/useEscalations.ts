import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addBonusAndRenotify, listEscalations } from "@/services/escalations";
import { ESCALATION_REFETCH_MS } from "./liveness";
import { dashboardKeys } from "./useDashboard";
import { technicianKeys } from "./useTechnicians";
import { escalationKeys, ticketKeys } from "./useTickets";

// Re-exported so call sites still read `from "@/hooks/useEscalations"`. The
// tuple itself is declared beside `ticketKeys`, because the ticket mutations
// have to invalidate it and two modules importing each other is worse than one
// re-export. See the note there.
export { escalationKeys };

/**
 * Time-sensitive: every row is counting down to a slot the customer was
 * promised, so this refetches far more eagerly than an ordinary list.
 *
 * No params and no `keepPreviousData`: the queue is a whole-queue read (see
 * `listEscalations`), so there is no page change to hold rows across, and
 * holding stale rows on a countdown screen would be the wrong trade anyway.
 *
 * The sidebar badge reads this same query rather than counting separately, so
 * the rail and the screen can never disagree and the two share one request.
 *
 * `refetchInterval` is what keeps the countdowns moving — see
 * `ESCALATION_REFETCH_MS`. It is a repaint as much as a refresh.
 *
 * `enabled` exists for the sidebar, which mounts on every screen: the endpoint
 * is gated on `jobs.assign` and a rank floor, so without it every Ops Staff
 * session would fetch a 403 once a minute for a badge it cannot see. The queue
 * page itself is already behind the same feature guard and needs no argument.
 */
export function useEscalations({ enabled = true } = {}) {
  return useQuery({
    queryKey: escalationKeys.list(),
    queryFn: listEscalations,
    staleTime: 10_000,
    refetchInterval: ESCALATION_REFETCH_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/**
 * Funding a bonus moves the ticket out of this queue and back into the pool,
 * so three prefixes go stale at once — and the technician prefix with them,
 * because who is being offered what is half of "who has bandwidth left".
 *
 * There is no `useEscalation(id)` any more. A single escalation IS a ticket,
 * and both screens that act on one now read it through `useTicket(id)` — one
 * cache entry for one row, rather than two that could disagree about the same
 * ticket's status while a manager decided.
 */
export function useAddBonus() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't add the bonus" },
    mutationFn: addBonusAndRenotify,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: escalationKeys.all });
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: technicianKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
