import { useState } from "react";
import { PageMeta } from "@/components/shared/PageMeta";
import { LedgerTable } from "@/components/ledger/LedgerTable";
import { PoolSummary } from "@/components/ledger/PoolSummary";
import { useLedgerEntries, useLedgerPool } from "@/hooks/useLedger";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";

export default function LedgerPage() {
  const pool = useLedgerPool();

  // Newest first — a ledger is read from the most recent transaction back.
  // No `page`: the table loads on scroll, so the cursor lives inside the
  // infinite query rather than in this screen's state.
  const [params, setParams] = useState<ListParams>({
    limit: DEFAULT_PAGE_SIZE,
    sortBy: "date",
    sortDir: "desc",
  });

  // Merged into the current query, not swapped for it — "Clear filters" resets
  // several things at once, and a replacing setter would let the last win.
  //
  // `page` is dropped on the way in. The table still reports it when a filter
  // changes ("and start from the top"), which is right for a pager and
  // meaningless here: changing the filter already restarts the query from page
  // one, and keeping the number would only churn the cache key.
  const applyParams = (next: ListParams) =>
    setParams((prev) => ({
      ...prev,
      ...next,
      page: undefined,
      filters: { ...prev.filters, ...next.filters },
    }));

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
