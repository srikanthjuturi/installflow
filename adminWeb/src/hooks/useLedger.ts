import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";

export const ledgerKeys = {
  all: ["ledger"] as const,
  /** `franchiseeId` is part of the identity: whose pool this is (Task 05 F12). */
  pool: (franchiseeId?: string | null) =>
    ["ledger", "pool", franchiseeId ?? null] as const,
  entries: (params: ListParams) => ["ledger", "entries", params] as const,
};

/**
 * The pool balance and the transaction list are two reads, not one, because
 * the backend serves them that way — a rolling balance plus a paged ledger.
 * Split like this, paging the table leaves the summary alone: the balance is
 * the whole pool, not the sum of the rows on screen.
 */
export function useLedgerPool(franchiseeId?: string | null) {
  const { api, workspace } = useWorkspace();
  return useQuery({
    queryKey: ledgerKeys.pool(franchiseeId),
    queryFn: () => api.ledger.pool({ franchiseeId }),
    staleTime: 30_000,
    // Only the staff console passes an id here (§5.10's Admin/NH selector), so
    // a portal session arriving at this hook with one is a caller bug — and
    // `require_franchise_principal` would refuse it anyway. Disabled, not
    // sent, so the mistake shows as a blank screen instead of a stranger's
    // money in the tiles.
    enabled: workspace === "ops" || !franchiseeId,
  });
}

/**
 * The ledger, a page at a time, appended.
 *
 * Infinite rather than paged because of what this list IS: a ledger is read
 * backwards from the most recent movement, and "how far back does this go"
 * is answered by scrolling, not by choosing page 4 of 17. Page numbers over a
 * chronological record ask the reader to convert a date into an ordinal.
 *
 * `params` carries the filter and the sort. The page is the cursor and belongs
 * to the query, so it is stripped below rather than trusted to be absent:
 * leaving one in the key would mint a fresh infinite query — discarding every
 * loaded page — each time the cursor moved.
 *
 * No `keepPreviousData`. It was there so paging did not blank a table the
 * reader was comparing rows in; appending never blanks anything, and holding
 * the previous FILTER's rows while the new filter loads would show a list that
 * contradicts the control above it.
 */
export function useLedgerEntries(params: ListParams = {}) {
  const { api } = useWorkspace();
  // `undefined` and absent hash identically, so this really does leave the key
  // free of the cursor.
  const key: ListParams = { ...params, page: undefined };

  return useInfiniteQuery({
    queryKey: ledgerKeys.entries(key),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.ledger.entries({
        ...key,
        page: pageParam,
        limit: key.limit ?? DEFAULT_PAGE_SIZE,
      }),
    getNextPageParam: (last) =>
      last.pagination.hasNextPage ? last.pagination.page + 1 : undefined,
    staleTime: 30_000,
  });
}

/**
 * Reverse one pool penalty in full, with a reason — the pool screen's action.
 *
 * Only the franchise portal mounts it (`services/workspace.ts`: the staff pool
 * screen carries no row action by owner ruling — staff reverse happens on the
 * ticket page, whose door `useReversePenalty` already reaches), so the ops
 * adapter's `reverse: null` never runs. The guard is a throw rather than a
 * silent no-op: a mutation firing against nothing would be a bug to hear about.
 */
export function useReversePoolPenalty() {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't reverse the penalty" },
    mutationFn: (input: { id: string; reason: string }) => {
      if (!api.ledger.reverse) {
        throw new Error("The pool table carries no actions in this workspace.");
      }
      return api.ledger.reverse(input);
    },
    onSuccess: () => {
      // The pool balance IS the entries' arithmetic, so both halves refresh
      // together and the tiles never disagree with the table beneath them.
      void queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
    },
  });
}
