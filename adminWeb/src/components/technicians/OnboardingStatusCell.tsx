import { cn } from "@/lib/utils";
import type { TechnicianRow } from "@/types/technician";
import { TechStatusPill } from "./BandwidthBar";
import { STATUS_CLASS, STATUS_DOT, STATUS_LABEL } from "./onboarding";

/**
 * The Status column, for both halves of the union.
 *
 * A pending invite has no operating status — it has a delivery one. A
 * registered technician has the reverse. Rendering them in one cell keeps the
 * column meaning "where is this person up to", which is the question the screen
 * exists to answer.
 *
 * The dot is redundant with the word on purpose: colour alone would fail
 * WCAG 1.4.1, and "Delivery failed" is exactly the row a manager scans for.
 */
export function OnboardingStatusCell({ row }: { row: TechnicianRow }) {
  if (row.registered) {
    return <TechStatusPill status={row.status} />;
  }

  return (
    /* `items-start` or the column stretches the pill to the cell width — a
       flex parent overrides the child's own inline sizing. */
    <div className="flex flex-col items-start gap-0.5">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium",
          STATUS_CLASS[row.status]
        )}
      >
        <span
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[row.status])}
          aria-hidden
        />
        {STATUS_LABEL[row.status]}
      </span>
      {row.failureReason ? (
        /* Truncated inline, full text on hover — a Meta error can run to a
           paragraph, and the manager mostly needs to know there was one. */
        <span
          className="max-w-45 truncate text-[11px] text-ink-3"
          title={row.failureReason}
        >
          {row.failureReason}
        </span>
      ) : null}
    </div>
  );
}
