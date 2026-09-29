import { cn } from "@/lib/utils";
import {
  VENDOR_PAYMENT_STATE_LABELS,
  VENDOR_REQUEST_STATUS_LABELS,
  type VendorPaymentState,
  type VendorRequestStatus,
} from "@/types/vendorCredit";

/**
 * Where a vendor's payment stands. Static class strings — an interpolated tint
 * is never generated (hard rule 6). Read by the vendor's own page and the ops
 * queue alike, so both call a state by the same word.
 *
 * The same tints `RechargeBadge` uses, deliberately: it is the same shape of
 * thing one level along, and two different colour schemes for "somebody claims
 * they paid" would make the two screens harder to read together, not easier.
 * Rejected is `danger`-free for the reason `RedemptionBadge` gives: a refusal
 * with a reason is a decision, not a failure.
 */
const PAYMENT_CLASS: Record<VendorPaymentState, string> = {
  to_pay: "bg-warn-bg text-warn",
  waiting: "bg-info-bg text-info",
  paid: "bg-ok-bg text-ok",
  rejected: "bg-surface-3 text-ink-2",
  cancelled: "bg-surface-3 text-ink-3",
};

export function VendorPaymentBadge({
  state,
  className,
}: {
  state: VendorPaymentState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        PAYMENT_CLASS[state],
        className
      )}
    >
      {VENDOR_PAYMENT_STATE_LABELS[state]}
    </span>
  );
}

const REQUEST_CLASS: Record<VendorRequestStatus, string> = {
  pending: "bg-info-bg text-info",
  approved: "bg-ok-bg text-ok",
  rejected: "bg-surface-3 text-ink-2",
  cancelled: "bg-surface-3 text-ink-3",
};

export function VendorRequestBadge({
  status,
  className,
}: {
  status: VendorRequestStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        REQUEST_CLASS[status],
        className
      )}
    >
      {VENDOR_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Whether a vendor can raise anything. Its own badge rather than a colour on the
 * number, because "used up" is the fact somebody scanning the list is looking
 * for and a red figure reads as a formatting choice.
 */
export function VendorLineBadge({
  paused,
  className,
}: {
  paused: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        paused ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok",
        className
      )}
    >
      {paused ? "Used up" : "Active"}
    </span>
  );
}
