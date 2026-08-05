import { useQuery } from "@tanstack/react-query";
import { getLedgerPool, listLedgerEntries } from "@/services/ledger";

export const ledgerKeys = {
  all: ["ledger"] as const,
  pool: () => ["ledger", "pool"] as const,
  entries: () => ["ledger", "entries"] as const,
};

/**
 * The pool balance and the transaction list are two reads, not one, because
 * the backend will serve them that way — a rolling balance plus a paged
 * ledger. Splitting them now means the table can paginate later without the
 * summary re-fetching.
 */
export function useLedgerPool() {
  return useQuery({
    queryKey: ledgerKeys.pool(),
    queryFn: getLedgerPool,
    staleTime: 30_000,
  });
}

export function useLedgerEntries() {
  return useQuery({
    queryKey: ledgerKeys.entries(),
    queryFn: listLedgerEntries,
    staleTime: 30_000,
  });
}
