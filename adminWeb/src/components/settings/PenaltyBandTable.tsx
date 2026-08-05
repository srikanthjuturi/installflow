import { Skeleton } from "@/components/ui/skeleton";
import type { PenaltyBand } from "@/services/settings";
import { money } from "@/utils/money";

/**
 * Cancellation penalty bands — how much a technician is charged for cancelling,
 * banded by how close to the confirmed slot they walked away.
 *
 * ⚠ These amounts and boundaries contradict the technician app. See the note on
 * `RULES.penalty` in `services/settings.ts`; it is an open business decision,
 * so this screen shows the approved web prototype's figures unreconciled.
 *
 * Same shape as `SlaRuleList` — term and definition, no sortable columns — so
 * it is a description list rather than a table, and needs no invented headers.
 */

const ROW =
  "border-line-2 bg-surface-2 flex items-center justify-between gap-3 rounded-md border px-3.25 py-2.75";

interface PenaltyBandTableProps {
  bands: PenaltyBand[];
  /** Per technician, per month. */
  cap: number;
}

export function PenaltyBandTable({ bands, cap }: PenaltyBandTableProps) {
  return (
    <>
      <dl className="flex flex-col gap-2.5">
        {bands.map((b) => (
          <div key={b.band} className={ROW}>
            <dt className="text-[13px] text-ink-2">{b.band}</dt>
            {/* Money is a debit against the technician; the tint is a second
                encoding, never the only one — the band name carries it. */}
            <dd className="font-mono text-sm font-semibold text-danger">
              {money(b.amount)}
            </dd>
          </div>
        ))}
      </dl>

      {/* The prototype's own cap string reads "₹5,000 / technician / month",
          which duplicates the sentence it sits inside. Rendered through
          `money()` so the figure matches the ledger's formatting exactly. */}
      <p className="mt-3.5 text-xs text-ink-3">
        Monthly cap: <b className="text-ink">{money(cap)}</b> per technician
      </p>
    </>
  );
}

export function PenaltyBandTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={ROW}>
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3.5 w-14" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-3.5 h-3 w-48" />
    </>
  );
}
