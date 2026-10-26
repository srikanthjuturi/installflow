import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/states";
import { useTechnicianTransfers } from "@/hooks/useTechnicians";
import type { Technician } from "@/types/technician";
import { historyDate, historyLine } from "./transferPlan";

/**
 * Every time this technician changed franchisee (Task 17 §5.3), newest first.
 *
 * Staff only — the reason is the company's note about a franchisee — so the page
 * mounts it for the ops workspace alone. The server is append-only: a wrong move
 * is corrected by another move, and this list shows both.
 */
export function TechTransferHistory({ tech }: { tech: Technician }) {
  const transfers = useTechnicianTransfers(tech.id);

  return (
    <Card>
      <CardContent>
        <h3 className="text-[11px] font-bold tracking-[0.04em] text-ink-3 uppercase">
          Transfer history
        </h3>
        <p className="mb-3 text-xs text-ink-3">
          Every time this technician changed franchisee
        </p>

        {transfers.isLoading ? (
          <div aria-busy="true" className="grid gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="grid gap-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : transfers.isError ? (
          <ErrorState
            title="Couldn't load the transfer history"
            error={transfers.error}
            onRetry={() => transfers.refetch()}
          />
        ) : !transfers.data || transfers.data.length === 0 ? (
          <p className="text-[13px] text-ink-2">
            Never moved. Works for {tech.franchiseeName} since{" "}
            {historyDate(tech.createdAt)}.
          </p>
        ) : (
          <ol className="grid gap-3">
            {transfers.data.map((row) => {
              const line = historyLine(row);
              return (
                <li
                  key={row.id}
                  className="grid gap-0.5 border-b border-line-2 pb-3 last:border-0 last:pb-0"
                >
                  <p className="text-[13px] font-medium">{line.head}</p>
                  <p className="text-xs text-ink-2">{line.detail}</p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
