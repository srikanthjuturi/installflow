import { useMemo } from "react";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { ErrorState } from "@/components/shared/states";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Kpi } from "@/types/dashboard";
import {
  DOC_TYPE_LABELS,
  type TransactionSummary,
} from "@/types/transaction";
import { moneyPaise } from "@/utils/money";

/**
 * The four headline figures and the per-type breakdown, over the SAME filters
 * as the table beneath (the summary endpoint takes the list's own query), so a
 * figure and the rows behind it can never disagree.
 *
 * Net is debit minus credit: positive means the parties owe the company more
 * than they have paid.
 */
export function TransactionKpis({
  summary,
  isLoading,
  error,
  onRetry,
}: {
  summary?: TransactionSummary;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const kpis = useMemo<Kpi[]>(
    () => [
      {
        key: "debit",
        label: "Debits",
        value: moneyPaise(summary?.debitPaise ?? 0),
        sub: "Raises what the party owes",
      },
      {
        key: "credit",
        label: "Credits",
        value: moneyPaise(summary?.creditPaise ?? 0),
        sub: "Reduces what the party owes",
      },
      {
        key: "net",
        label: "Net",
        value: moneyPaise(summary?.netPaise ?? 0),
        sub: "Debits less credits",
      },
      {
        key: "count",
        label: "Documents",
        value: String(summary?.count ?? 0),
        sub: "In the period and filters",
      },
    ],
    [summary]
  );

  if (error && !summary) {
    return (
      <Card className="mb-4">
        <CardContent>
          <ErrorState
            title="Couldn't load the totals"
            error={error}
            onRetry={onRetry}
          />
        </CardContent>
      </Card>
    );
  }

  if (isLoading && !summary) {
    return (
      <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2.5 h-7 w-28" />
              <Skeleton className="mt-1.5 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const byType = summary?.byType ?? [];
  return (
    <div className="mb-4 grid gap-3.5">
      <KpiRow kpis={kpis} />
      {byType.length > 0 ? (
        <Card>
          <CardContent>
            <div className="mb-2 text-xs font-medium text-ink-2">By type</div>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {byType.map((t) => (
                <li
                  key={t.docType}
                  className="flex items-baseline justify-between gap-3 text-[13px]"
                >
                  <span>
                    {DOC_TYPE_LABELS[t.docType]}{" "}
                    <span className="text-ink-3">· {t.count}</span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {moneyPaise(t.totalPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
