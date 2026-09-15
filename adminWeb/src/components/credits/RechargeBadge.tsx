import { cn } from "@/lib/utils";
import { RECHARGE_STATE_LABELS, type RechargeState } from "@/types/credits";

/**
 * Where a recharge stands. Static class strings — an interpolated tint is never
 * generated (hard rule 6). Read by the company's Credits page and the
 * superadmin's queue alike, so both call a state by the same word.
 *
 * "To pay" is `warn` on the company's side of it and "Waiting" `info` — each is
 * work for somebody. Rejected is `danger`-free for the reason `RedemptionBadge`
 * gives: a refusal with a reason is a decision, not a failure.
 */
const STATE_CLASS: Record<RechargeState, string> = {
  to_pay: "bg-warn-bg text-warn",
  waiting: "bg-info-bg text-info",
  credited: "bg-ok-bg text-ok",
  rejected: "bg-surface-3 text-ink-2",
  cancelled: "bg-surface-3 text-ink-3",
};

export function RechargeBadge({
  state,
  className,
}: {
  state: RechargeState;
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
      {RECHARGE_STATE_LABELS[state]}
    </span>
  );
}
