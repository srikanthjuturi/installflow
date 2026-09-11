import { cn } from "@/lib/utils";
import {
  REDEMPTION_STATE_LABELS,
  type RedemptionState,
} from "@/types/redemption";

/**
 * Where a redemption stands. Static class strings — an interpolated tint is
 * never generated (hard rule 6). Private to this slice: one consumer family.
 *
 * "To pay" is `warn` because it is the one that is work for the reader.
 * Declined is neutral rather than `danger`: refusing to pay before paying is a
 * decision somebody made, not a failure — `danger` is spoken for by the rows
 * about a customer already let down.
 */
const STATE_CLASS: Record<RedemptionState, string> = {
  to_pay: "bg-warn-bg text-warn",
  awaiting: "bg-info-bg text-info",
  settled: "bg-ok-bg text-ok",
  declined: "bg-surface-3 text-ink-2",
};

export function RedemptionBadge({
  state,
  className,
}: {
  state: RedemptionState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        STATE_CLASS[state],
        className
      )}
    >
      {REDEMPTION_STATE_LABELS[state]}
    </span>
  );
}
