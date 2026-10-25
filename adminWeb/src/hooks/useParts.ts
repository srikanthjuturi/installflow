import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  addPart,
  approvePartRequest,
  getCatalogue,
  getPartRequest,
  getPartRequestCounts,
  issuePartRequest,
  listPartRequests,
  rejectPartRequest,
  removePart,
  returnPartRequest,
  updatePart,
} from "@/services/parts";
import type { ListParams } from "@/types/api";
import type { CatalogueOwner } from "@/types/parts";
import { BACKSTOP_REFETCH_MS } from "./liveness";
import { notificationKeys } from "./useNotifications";
import { ticketKeys } from "./useTickets";

/**
 * Spare parts server state — Task 13 §5.3.
 *
 * `catalogue` sits under `["parts", "catalogue"]` so ONE prefix invalidation
 * after any catalogue write re-reads every open list: a part added to a
 * category moves the inherited list of every node and product beneath it, and
 * an editor that refreshed only its own owner would leave a sibling dialog (or
 * the next one opened) showing the old inheritance.
 */
export const partKeys = {
  all: ["parts"] as const,
  catalogue: (o: CatalogueOwner) =>
    ["parts", "catalogue", o.kind, o.id] as const,
  requests: (p: ListParams) => ["parts", "requests", p] as const,
  request: (id: string) => ["parts", "request", id] as const,
  counts: ["parts", "counts"] as const,
};

const CATALOGUE_PREFIX = ["parts", "catalogue"] as const;

/* ── the catalogue ───────────────────────────────────────────────────────── */

/** Read while its dialog is open only — `enabled` keeps a closed dialog silent. */
export function useCatalogue(owner: CatalogueOwner, { enabled = true } = {}) {
  return useQuery({
    queryKey: partKeys.catalogue(owner),
    queryFn: () => getCatalogue(owner),
    enabled,
    // The dialog is the editor: what it shows must be what the server holds.
    staleTime: 0,
    meta: { errorTitle: "Couldn't load the parts list" },
  });
}

function useCatalogueMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: CATALOGUE_PREFIX }),
    meta: { errorTitle },
  });
}

export const useAddPart = (owner: CatalogueOwner) =>
  useCatalogueMutation(
    (name: string) => addPart(owner, name),
    "Couldn't add the part"
  );

export const useUpdatePart = () =>
  useCatalogueMutation(
    (vars: { id: string; name?: string; isActive?: boolean }) => {
      const { id, ...body } = vars;
      return updatePart(id, body);
    },
    "Couldn't update the part"
  );

export const useRemovePart = () =>
  useCatalogueMutation(
    (id: string) => removePart(id),
    "Couldn't remove the part"
  );

/* ── requests ────────────────────────────────────────────────────────────── */

/**
 * The facility's queue. The socket's `notification.raised` invalidates
 * `partKeys.all` (a new request rings the desk's bell), so this is current
 * without polling; the focus refetch covers a tab left open.
 */
export function usePartRequests(params: ListParams) {
  return useQuery({
    queryKey: partKeys.requests(params),
    queryFn: () => listPartRequests(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    meta: { errorTitle: "Couldn't load part requests" },
  });
}

/**
 * One request. `staleTime: 0` because the return photo's link inside it is
 * signed for fifteen minutes — the `useTicketProof` rule.
 */
export function usePartRequest(id: string) {
  return useQuery({
    queryKey: partKeys.request(id),
    queryFn: () => getPartRequest(id),
    staleTime: 0,
    meta: { errorTitle: "Couldn't load the request" },
  });
}

/**
 * The portal rail's badge — what is waiting on this desk. A backstop, and it
 * must never toast: a rail badge failing quietly is better than a red banner
 * over every page. Only the PORTAL rail uses it (owner ruling 2026-10-15, R4):
 * the staff console has no parts queue, so no staff hook ever calls this.
 */
export function usePartRequestCounts({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: partKeys.counts,
    queryFn: getPartRequestCounts,
    enabled,
    staleTime: 30_000,
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
    meta: { suppressErrorToast: true },
  });
}

/**
 * Every request action moves the queue, the badge, the request page, the
 * ticket's status and panel, and (a rejection rings the territory's bell) the
 * notifications — so all four prefixes go stale together.
 */
function usePartAction<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partKeys.all });
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
    // A 409 PART_REQUEST_BAD_STATE (two tabs) says what happened in the toast;
    // the page then needs the truth, not the stale buttons.
    onError: () => qc.invalidateQueries({ queryKey: partKeys.all }),
    meta: { errorTitle },
  });
}

export const useApprovePartRequest = () =>
  usePartAction(
    (v: { id: string; addToCatalogue: boolean }) =>
      approvePartRequest(v.id, { addToCatalogue: v.addToCatalogue }),
    "Couldn't approve the request"
  );

export const useRejectPartRequest = () =>
  usePartAction(
    (v: { id: string; reason: string }) =>
      rejectPartRequest(v.id, { reason: v.reason }),
    "Couldn't reject the request"
  );

export const useIssuePartRequest = () =>
  usePartAction(
    (v: { id: string; note: string | null }) =>
      issuePartRequest(v.id, { note: v.note }),
    "Couldn't mark it issued"
  );

export const useReturnPartRequest = () =>
  usePartAction(
    (v: { id: string; note: string | null; photoBlobName: string | null }) =>
      returnPartRequest(v.id, { note: v.note, photoBlobName: v.photoBlobName }),
    "Couldn't log the return"
  );
