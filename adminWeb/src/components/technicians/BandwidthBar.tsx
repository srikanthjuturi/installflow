import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TechnicianStatus } from "@/types/technician";
import { TECH_STATUS_LABEL } from "./technicianSchema";

/**
 * The technician presentation atoms.
 *
 * `BandwidthBar` is the headline export, but the Active/Inactive pill and the
 * cancellation count are each rendered identically by the master list and the
 * profile. They live here — the leaf module with no card or table dependency —
 * so neither screen has to import the other's chunk to reuse them, and the two
 * can never drift. (The avatar itself is the shared `UserAvatar`, so a
 * technician's face looks the same here, in the pool and in the escalation
 * shortlist.)
 */

/* ---------------------------------------------------------------- bandwidth */

/**
 * Bandwidth is a plain jobs-per-day cap — used out of total, never weighted by
 * job type. The bar is a redundant encoding: the `3/5` beside it is the real
 * answer, so the bar itself is hidden from assistive tech.
 *
 * **A null total means no limit**, which is the default for a technician nobody
 * has capped. There is no proportion to draw then, so the bar is omitted and
 * the count reads "3 today" rather than inventing a denominator.
 */
const FILL: Record<"idle" | "ok" | "near", string> = {
  idle: "bg-ink-3",
  ok: "bg-ok",
  near: "bg-warn",
};

export function BandwidthBar({
  used,
  total,
  showValue = true,
  className,
  trackClassName,
}: {
  used: number;
  /** Null = no limit. */
  total: number | null;
  showValue?: boolean;
  className?: string;
  trackClassName?: string;
}) {
  const pct =
    total && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  // >79% is the prototype's "nearly full" threshold; an unused technician
  // reads as neutral rather than healthy.
  const fill = used === 0 ? "idle" : pct > 79 ? "near" : "ok";

  if (total == null) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {showValue ? (
          <span className="text-xs text-ink-2 tabular-nums">
            {used} today
            <span className="ml-1 text-ink-3">· no limit</span>
          </span>
        ) : (
          <span className="text-xs text-ink-3">No limit</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "h-1.5 w-13.5 shrink-0 overflow-hidden rounded-full bg-surface-3",
          trackClassName
        )}
        aria-hidden
      >
        <div
          className={cn("h-full rounded-full", FILL[fill])}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue ? (
        <span className="text-xs text-ink-2 tabular-nums">
          {used}/{total}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- status */

/** Static strings — an interpolated `bg-${status}` is never generated. */
const STATUS_CLASS: Record<TechnicianStatus, string> = {
  active: "bg-ok-bg text-ok",
  inactive: "bg-background text-ink-3",
  suspended: "bg-danger-bg text-danger",
};

/** Carries the word, not just the tint. */
export function TechStatusPill({ status }: { status: TechnicianStatus }) {
  return (
    <span
      className={cn(
        // `w-fit` so a flex or grid parent cannot stretch the tint across the
        // whole cell — the pill sizes to its word wherever it is dropped.
        "inline-flex w-fit items-center rounded-full px-2.25 py-0.75 text-[11px] font-semibold whitespace-nowrap",
        STATUS_CLASS[status]
      )}
    >
      {TECH_STATUS_LABEL[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ cancels */

/**
 * A high cancellation count is a risk signal: every cancellation costs the
 * technician a banded penalty and, close to the slot, escalates to the ASM.
 * The band is carried by an icon and a screen-reader word as well as the
 * tint — colour alone would fail WCAG 1.4.1.
 */
type CancelBand = "normal" | "elevated" | "high";

function bandFor(cancels: number): CancelBand {
  if (cancels >= 10) return "high";
  if (cancels >= 6) return "elevated";
  return "normal";
}

const CANCEL_CLASS: Record<CancelBand, string> = {
  normal: "text-ink",
  elevated: "text-warn",
  high: "text-danger",
};

const CANCEL_NOTE: Record<CancelBand, string> = {
  normal: "",
  elevated: "Elevated cancellation count",
  high: "High cancellation count",
};

export function CancelCount({
  cancels,
  className,
}: {
  cancels: number;
  className?: string;
}) {
  const band = bandFor(cancels);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold",
        CANCEL_CLASS[band],
        className
      )}
    >
      {band === "normal" ? null : (
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="tabular-nums">{cancels}</span>
      {band === "normal" ? null : (
        <span className="sr-only">— {CANCEL_NOTE[band]}</span>
      )}
    </span>
  );
}
