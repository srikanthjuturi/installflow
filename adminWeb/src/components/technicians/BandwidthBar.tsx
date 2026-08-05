import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Technician } from "@/types";

/**
 * The technician presentation atoms.
 *
 * `BandwidthBar` is the headline export, but the initials avatar, the
 * Active/Inactive pill and the cancellation count are each rendered
 * identically by the master list and the profile. They live here — the
 * leaf module with no card or table dependency — so neither screen has to
 * import the other's chunk to reuse them, and the two can never drift.
 */

/* ---------------------------------------------------------------- bandwidth */

/**
 * Bandwidth is a plain jobs-per-day cap — used out of total, never weighted
 * by job type. The bar is a redundant encoding: the `3/5` beside it is the
 * real answer, so the bar itself is hidden from assistive tech.
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
  total: number;
  showValue?: boolean;
  className?: string;
  trackClassName?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  // >79% is the prototype's "nearly full" threshold; an unused technician
  // reads as neutral rather than healthy.
  const fill = used === 0 ? "idle" : pct > 79 ? "near" : "ok";

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

/* ------------------------------------------------------------------- avatar */

const AVATAR_SIZE = {
  sm: "size-8.5 text-xs",
  lg: "size-18 text-[26px]",
};

/** Initials disc. Decorative — the name is always rendered beside or below it. */
export function TechAvatar({
  name,
  size = "sm",
}: {
  name: string;
  size?: keyof typeof AVATAR_SIZE;
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2);

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-status-assigned-bg font-semibold text-brand-400",
        AVATAR_SIZE[size]
      )}
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------- status */

const STATUS_CLASS: Record<Technician["status"], string> = {
  Active: "bg-ok-bg text-ok",
  Inactive: "bg-background text-ink-3",
};

/** Carries the word, not just the tint. */
export function TechStatusPill({ status }: { status: Technician["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.25 py-0.75 text-[11px] font-semibold whitespace-nowrap",
        STATUS_CLASS[status]
      )}
    >
      {status}
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
