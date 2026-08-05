import { useState } from "react";
import { PageMeta } from "@/components/shared/PageMeta";
import { LedgerTable } from "@/components/ledger/LedgerTable";
import { PoolSummary } from "@/components/ledger/PoolSummary";
import { useLedgerEntries, useLedgerPool } from "@/hooks/useLedger";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";

export default function LedgerPage() {
  const pool = useLedgerPool();

  // Newest first — a ledger is read from the most recent transaction back.
  const [params, setParams] = useState<ListParams>({
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
    sortBy: "date",
    sortDir: "desc",
  });

  // Merged into the current query, not swapped for it — "Clear filters" resets
  // several things at once, and a replacing setter would let the last win.
  const applyParams = (next: ListParams) =>
    setParams((prev) => ({
      ...prev,
      ...next,
      filters: { ...prev.filters, ...next.filters },
    }));

  const entries = useLedgerEntries(params);

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
        entries={entries.data?.rows}
        meta={entries.data?.pagination}
        params={params}
        onParams={applyParams}
        isLoading={entries.isLoading}
        error={entries.isError ? entries.error : null}
        onRetry={() => entries.refetch()}
      />
    </>
  );
}
