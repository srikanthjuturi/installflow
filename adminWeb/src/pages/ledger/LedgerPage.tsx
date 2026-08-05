import { PageMeta } from "@/components/shared/PageMeta";
import { LedgerTable } from "@/components/ledger/LedgerTable";
import { PoolSummary } from "@/components/ledger/PoolSummary";
import { useLedgerEntries, useLedgerPool } from "@/hooks/useLedger";

export default function LedgerPage() {
  const pool = useLedgerPool();
  const entries = useLedgerEntries();

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
        entries={entries.data}
        isLoading={entries.isLoading}
        error={entries.isError ? entries.error : null}
        onRetry={() => entries.refetch()}
      />
    </>
  );
}
