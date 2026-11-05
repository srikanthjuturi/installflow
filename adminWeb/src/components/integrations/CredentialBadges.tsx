import { cn } from "@/lib/utils";
import type { CredentialStatus } from "@/types/integration";

/**
 * Whether a credential still works. A word AND a tint: colour alone fails WCAG
 * 1.4.1, and "can their CRM still call us?" is the question the row answers.
 *
 * Static class strings — an interpolated tint is never generated (hard rule 6).
 */
const STATUS_CLASS: Record<CredentialStatus, string> = {
  Active: "bg-ok-bg text-ok",
  Revoked: "bg-surface-3 text-ink-2",
};

export function CredentialStatusBadge({
  status,
  className,
}: {
  status: CredentialStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        STATUS_CLASS[status],
        className
      )}
    >
      {status}
    </span>
  );
}
