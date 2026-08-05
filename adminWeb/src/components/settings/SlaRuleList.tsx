import { Skeleton } from "@/components/ui/skeleton";
import type { SlaRule } from "@/services/settings";

/**
 * A read-only rule → setting list.
 *
 * The prototype draws these as two-column rows, which is a description list,
 * not a table: each row is one term and its definition, and there is no column
 * to sort or scan across. `<dl>` gets that across without inventing "Rule" /
 * "Value" column headers the approved design never had.
 *
 * The SLA card and the Timing & bandwidth card are the same shape, so both use
 * this — the SLA one through the named wrapper below.
 */

const ROW =
  "border-line-2 bg-surface-2 flex items-center justify-between gap-3 rounded-md border px-3.25 py-2.75";

export function RuleList({ rules }: { rules: SlaRule[] }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {rules.map((rule) => (
        <div key={rule.label} className={ROW}>
          <dt className="text-[13px] text-ink-2">{rule.label}</dt>
          <dd className="text-right text-[13px] font-semibold">{rule.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The four SLA windows and triggers. */
export function SlaRuleList({ rules }: { rules: SlaRule[] }) {
  return <RuleList rules={rules} />;
}

/** Matches the real rows so the card does not resize when data lands. */
export function RuleListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={ROW}>
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}
