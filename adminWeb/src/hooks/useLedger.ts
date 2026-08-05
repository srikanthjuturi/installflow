import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getLedgerPool, listLedgerEntries } from "@/services/ledger";
import type { ListParams } from "@/types/api";

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

export function useLedgerEntries(params: ListParams = {}) {
  return useQuery({
    queryKey: ledgerKeys.entries(params),
    queryFn: () => listLedgerEntries(params),
    staleTime: 30_000,
    // Paging a ledger must not blank it — the reader is comparing rows.
    placeholderData: keepPreviousData,
  });
}
