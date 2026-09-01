import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/states";
import { moneyPaise } from "@/utils/money";
import type { LedgerPool } from "@/services/ledger";

interface PoolSummaryProps {
  pool?: LedgerPool;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Three tiles in one row on a desk monitor, stacked on a narrow window. */
const GRID = "grid grid-cols-1 gap-3.5 md:grid-cols-3";

export function PoolSummary({
  pool,
  isLoading,
  error,
  onRetry,
}: PoolSummaryProps) {
  if (error) {
    return (
      <ErrorState
        title="Couldn't load the pool balance"
        error={error}
        onRetry={onRetry}
      />
    );
  }

  if (isLoading || !pool) {
    return (
      <div className={GRID}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="mt-2.5 h-7 w-24" />
              <Skeleton className="mt-2 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Penalties fund bonuses — the balance is what is left of the money that came
  // in. Only claim the arithmetic when it actually holds. It always does now
  // the API derives the balance rather than storing it, and the guard stays
  // because a summary that silently stopped adding up would be worse than one
  // that stops claiming to.
  const balances =
    pool.penaltiesCollectedPaise - pool.bonusesPaidPaise === pool.balancePaise;

  return (
    <div>
      <div className={GRID}>
        <Card className="bg-linear-135 from-(--sidebar-from) to-brand-400 text-white ring-0 dark:to-(--sidebar-to)">
          <CardContent className="flex flex-col">
            <div className="text-xs font-medium opacity-80">
              Current pool balance
            </div>
            <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight">
              {moneyPaise(pool.balancePaise)}
            </div>
            <div className="mt-1.5 text-xs opacity-70">
              Available for escalation bonuses
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col">
            <div className="text-xs font-semibold text-danger">
              Penalties collected
            </div>
            <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight">
              {moneyPaise(pool.penaltiesCollectedPaise)}
            </div>
            <div className="mt-1.5 text-xs text-ink-3">
              across {pool.cancellations} cancellations
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col">
            <div className="text-xs font-semibold text-ok">
              Bonuses paid
            </div>
            <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight">
              {moneyPaise(pool.bonusesPaidPaise)}
            </div>
            <div className="mt-1.5 text-xs text-ink-3">
              across {pool.pickups} escalation pickups
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Money in equals money out. Spelling the sum out stops the three tiles
          reading as three unrelated figures. */}
      {balances ? (
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-ink-3">
          <span>
            <b className="font-semibold text-ink">
              {moneyPaise(pool.penaltiesCollectedPaise)}
            </b>{" "}
            Penalties collected
          </span>
          <span aria-hidden="true">−</span>
          <span className="sr-only">minus</span>
          <span>
            <b className="font-semibold text-ink">{moneyPaise(pool.bonusesPaidPaise)}</b>{" "}
            Bonuses paid
          </span>
          <span aria-hidden="true">=</span>
          <span className="sr-only">equals</span>
          <span>
            <b className="font-semibold text-ink">{moneyPaise(pool.balancePaise)}</b>{" "}
            Current pool balance
          </span>
        </p>
      ) : null}
    </div>
  );
}
