import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getLedgerPool, listLedgerEntries } from "@/services/ledger";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";

export const ledgerKeys = {
  all: ["ledger"] as const,
  pool: () => ["ledger", "pool"] as const,
  entries: (params: ListParams) => ["ledger", "entries", params] as const,
};

/**
 * The pool balance and the transaction list are two reads, not one, because
 * the backend serves them that way — a rolling balance plus a paged ledger.
 * Split like this, paging the table leaves the summary alone: the balance is
 * the whole pool, not the sum of the rows on screen.
 */
export function useLedgerPool() {
  return useQuery({
    queryKey: ledgerKeys.pool(),
    queryFn: getLedgerPool,
    staleTime: 30_000,
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
  // `undefined` and absent hash identically, so this really does leave the key
  // free of the cursor.
  const key: ListParams = { ...params, page: undefined };

  return useInfiniteQuery({
    queryKey: ledgerKeys.entries(key),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listLedgerEntries({
        ...key,
        page: pageParam,
        limit: key.limit ?? DEFAULT_PAGE_SIZE,
      }),
    getNextPageParam: (last) =>
      last.pagination.hasNextPage ? last.pagination.page + 1 : undefined,
    staleTime: 30_000,
  });
}
