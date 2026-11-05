import { cn } from "@/lib/utils";
import {
  DOC_TYPE_LABELS,
  EMAIL_SKIPPED_HINT,
  EMAIL_STATUS_LABELS,
  type DocType,
  type EmailStatus,
} from "@/types/transaction";

const PILL =
  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap";

/** Static class strings - an interpolated tint is never generated (hard rule 6). */
const EMAIL_CLASS: Record<EmailStatus, string> = {
  sent: "bg-ok-bg text-ok",
  pending: "bg-surface-3 text-ink-2",
  failed: "bg-danger-bg text-danger",
  skipped: "bg-surface-2 text-ink-3",
};

/**
 * Whether the document has been emailed to the company's Admins. Company and
 * platform surfaces only - a vendor or franchisee never sees this column.
 */
export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={cn(PILL, EMAIL_CLASS[status])}
      title={status === "skipped" ? EMAIL_SKIPPED_HINT : undefined}
    >
      {EMAIL_STATUS_LABELS[status]}
    </span>
  );
}

/** The document kind. One neutral tint: the debit / credit columns carry the meaning. */
export function DocTypeBadge({ type }: { type: DocType }) {
  return (
    <span className={cn(PILL, "bg-info-bg text-info")}>
      {DOC_TYPE_LABELS[type]}
    </span>
  );
}
