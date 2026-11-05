import { useQuery } from "@tanstack/react-query";
import { IDLE_REFETCH_MS, LIVE_REFETCH_MS } from "@/lib/liveLocation";
import {
  getTicketLocation,
  listAllLiveLocations,
  listLiveLocations,
} from "@/services/liveLocation";

export const liveLocationKeys = {
  ticket: (id: string) => ["live-location", "ticket", id] as const,
  list: ["live-location", "list"] as const,
  all: (companyId: string | null) =>
    ["live-location", "all", companyId] as const,
};

/**
 * No polling storm: every 20 s, only while the tab is visible
 * (`refetchIntervalInBackground` false) and only while a component using the
 * hook is mounted. A ticket query slows to a minute once the answer is null.
 */
const POLL = { refetchIntervalInBackground: false, staleTime: 10_000 } as const;

export function useTicketLiveLocation(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: liveLocationKeys.ticket(ticketId),
    queryFn: () => getTicketLocation(ticketId),
    enabled: enabled && Boolean(ticketId),
    ...POLL,
    // A null answer means "not sharing right now", which can change when the
    // technician opens the app - so it slows down rather than stops. The card
    // only exists while the ticket is active; when the job leaves that set the
    // card unmounts and the polling goes with it.
    refetchInterval: (q) =>
      q.state.data === null ? IDLE_REFETCH_MS : LIVE_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useLiveLocations(enabled = true) {
  return useQuery({
    queryKey: liveLocationKeys.list,
    queryFn: listLiveLocations,
    enabled,
    ...POLL,
    refetchInterval: LIVE_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useAllLiveLocations(companyId: string | null, enabled = true) {
  return useQuery({
    queryKey: liveLocationKeys.all(companyId),
    queryFn: () => listAllLiveLocations(companyId ?? undefined),
    enabled,
    ...POLL,
    refetchInterval: LIVE_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}
