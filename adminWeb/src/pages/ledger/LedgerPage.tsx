import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { LedgerTable } from "@/components/ledger/LedgerTable";
import { PoolSummary } from "@/components/ledger/PoolSummary";
import { useLedgerEntries, useLedgerPool } from "@/hooks/useLedger";
import { ALL_FILTER } from "@/hooks/useListParams";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";
import type { LedgerEntry } from "@/types";

/** The query-string key for the Type filter — the control's own name. */
const TYPE_PARAM = "type";
const KINDS: readonly LedgerEntry["kind"][] = ["penalty", "bonus", "reversal"];

export default function LedgerPage() {
  const pool = useLedgerPool();

  // The Type filter lives in the query string, like the ticket board's Status.
  // A filtered ledger is then a link somebody can paste, and "Back to ledger"
  // from a technician or a ticket — which keeps the query string — comes back
  // to the same filtered view rather than the whole ledger.
  //
  // Validated, not trusted: anything but the three kinds means no filter. Sent
  // as it stands, the API would match nothing and the screen would say nothing
  // matches under a dropdown naming a type that does not exist.
  const [searchParams, setSearchParams] = useSearchParams();
  const typeParam = searchParams.get(TYPE_PARAM);
  const kind = KINDS.find((k) => k === typeParam);

  // Newest first — a ledger is read from the most recent transaction back.
  // No `page`: the table loads on scroll, so the cursor lives inside the
  // infinite query rather than in this screen's state.
  const params = useMemo<ListParams>(
    () => ({
      limit: DEFAULT_PAGE_SIZE,
      sortBy: "date",
      sortDir: "desc",
      ...(kind ? { filters: { kind } } : {}),
    }),
    [kind]
  );

  // The Type is the only thing on this screen anybody can change — no column
  // sorts, and a list that loads on scroll has no page or page size — so it is
  // the only thing written back.
  //
  // "All" is the dropdown's value for "no filter", NOT a kind, so it removes
  // the key instead of travelling. It used to travel: "Clear filters" (and
  // picking "Type: all") asked the API for kind "all", which matches no rows,
  // and the ledger read "No transactions yet" over a pool full of them.
  const applyParams = (next: ListParams) => {
    const value = next.filters?.kind;
    const url = new URLSearchParams(searchParams);
    if (value && value !== ALL_FILTER) url.set(TYPE_PARAM, value);
    else url.delete(TYPE_PARAM);
    setSearchParams(url, { replace: true });
  };

  const entries = useLedgerEntries(params);
  // Every page loaded so far, in order. The table renders what it is given;
  // the accumulating is the query's job.
  const rows = entries.data?.pages.flatMap((p) => p.rows);
  const meta = entries.data?.pages.at(-1)?.pagination;

  return (
    <>
      <PageMeta
        title="Penalty & bonus pool"
        description="Cancellation penalties collected and the escalation bonuses they fund."
      />

      <PoolSummary
        pool={pool.data}
        isLoading={pool.isLoading}
        error={pool.isError ? pool.error : null}
        onRetry={() => pool.refetch()}
      />

      <LedgerTable
        entries={rows}
        meta={meta}
        params={params}
        onParams={applyParams}
        isLoading={entries.isLoading}
        // Refetching dims the rows; APPENDING must not. Without the second
        // half, loading page two greys out every row already on screen.
        isFetching={entries.isFetching && !entries.isFetchingNextPage}
        hasNextPage={entries.hasNextPage}
        isFetchingNextPage={entries.isFetchingNextPage}
        fetchNextPage={() => entries.fetchNextPage()}
        readAt={entries.dataUpdatedAt}
        error={entries.isError ? entries.error : null}
        onRetry={() => entries.refetch()}
      />
    </>
  );
}
