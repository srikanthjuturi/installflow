import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  assignTechnician,
  correctTicketSerial,
  createTicket,
  forceCloseTicket,
  getTicket,
  getTicketProof,
  listTechnicianJobs,
  listTechnicianTickets,
  listTickets,
} from "@/services/tickets";
import { dashboardKeys } from "./useDashboard";
import { BACKSTOP_REFETCH_MS } from "./liveness";
import { technicianKeys } from "./useTechnicians";
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
  proof: (id: string) => ["tickets", "proof", id] as const,
  /**
   * Under the `tickets` prefix on purpose, even though the screen showing it is
   * a technician's. Every mutation here already invalidates that prefix, and so
   * does the socket on `ticket.changed` — so a job this technician closes lands
   * on their profile without anything new having to remember to say so.
   */
  byTechnician: (technicianId: string, limit: number) =>
    ["tickets", "byTechnician", technicianId, limit] as const,
  /** The full, paged list behind the profile's "See all" — same prefix, same
   *  invalidation, but keyed on the whole request the way `list` is. */
  byTechnicianList: (technicianId: string, params: ListParams) =>
    ["tickets", "byTechnicianList", technicianId, params] as const,
};

export function useTickets(params: ListParams = {}) {
  return useQuery({
    queryKey: ticketKeys.list(params),
    queryFn: () => listTickets(params),
    // Hold the page already on screen while the next one loads. Without this
    // every page change empties the table back to skeletons, which reads as
    // the data having gone away rather than as a step sideways.
    placeholderData: keepPreviousData,
    // The socket keeps this current; the interval is the floor under it for a
    // socket that has died without saying so. See BACKSTOP_REFETCH_MS.
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The jobs on a technician's profile. A short peek, not a workspace — five
 * rows, no paging, most recent slot first.
 *
 * The response still carries `pagination.totalRecords` for the technician's
 * whole history, so the profile can say how many there are and link to them
 * without asking twice.
 *
 * Same backstop as the board and the detail: the socket keeps it current, and
 * the interval is the floor under a socket that has died without saying so.
 */
export function useTechnicianJobs(technicianId: string, limit = 5) {
  return useQuery({
    queryKey: ticketKeys.byTechnician(technicianId, limit),
    queryFn: () => listTechnicianJobs(technicianId, limit),
    enabled: Boolean(technicianId),
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Every ticket for one technician — the page behind "See all".
 *
 * The full workspace, not the peek: search, status, sort and paging all come
 * from the query string, exactly as on the ticket board, because this renders
 * the same `TicketTable`.
 */
export function useTechnicianTickets(
  technicianId: string,
  params: ListParams = {}
) {
  return useQuery({
    queryKey: ticketKeys.byTechnicianList(technicianId, params),
    queryFn: () => listTechnicianTickets(technicianId, params),
    enabled: Boolean(technicianId),
    // Same reason as the board: a page change should step sideways, not blank
    // the table back to skeletons.
    placeholderData: keepPreviousData,
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * One ticket, including the timeline the audit trail renders.
 *
 * The same backstop as the board, and it earns it more: this is the screen
 * somebody sits on while a job is happening, so it is the one most likely to be
 * left open long enough for a dead socket to matter.
 */
export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: () => getTicket(id),
    enabled: Boolean(id),
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The proof images, with signed URLs.
 *
 * `gcTime` is short and `staleTime` is zero on purpose: the URLs expire in
 * minutes, so a cached list outlives its own links and would render broken
 * images. Cheaper to re-read than to explain why the pictures went blank.
 */
export function useTicketProof(id: string, enabled = true) {
  return useQuery({
    queryKey: ticketKeys.proof(id),
    queryFn: () => getTicketProof(id),
    enabled: Boolean(id) && enabled,
    staleTime: 0,
    gcTime: 60_000,
  });
}

/**
 * Correct the expected serial. Whoever can see the ticket can fix it — and the
 * vendor most of all, since the invoice is theirs.
 */
export function useCorrectTicketSerial() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't correct the serial" },
    mutationFn: correctTicketSerial,
    onSuccess: (ticket) => {
      // The response IS the updated ticket, so seed the detail rather than
      // putting a spinner between the correction and the screen showing it.
      queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    },
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

/**
 * Manual assignment — the ops fallback when first-accept-wins found nobody.
 *
 * Invalidates the technician prefix too: who is assigned to what is half of
 * "who has bandwidth left", so leaving that list alone would show the manager
 * a shortlist that still counts the person they just picked as free.
 */
export function useAssignTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't assign the technician" },
    mutationFn: assignTechnician,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: technicianKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
