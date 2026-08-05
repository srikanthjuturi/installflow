import { cn } from "@/lib/utils";

/**
 * Match confidence, always read against the configured threshold — a bare
 * percentage means nothing without the line it failed to clear.
 *
 * Tone is never the only signal: the percentage and the words "Below
 * threshold" / "Above threshold" carry the same information for anyone who
 * cannot separate the colours.
 */

/** Static class strings — an interpolated `text-${tone}` is never generated. */
const TONES = {
  ok: { text: "text-ok", bar: "bg-ok" },
  warn: { text: "text-warn", bar: "bg-warn" },
  danger: { text: "text-danger", bar: "bg-danger" },
} as const;

function toneFor(pct: number, threshold: number) {
  if (pct >= threshold) return TONES.ok;
  if (pct >= 50) return TONES.warn;
  return TONES.danger;
}

interface ConfidenceMeterProps {
  /** 0–1, as the verification service reports it. */
  conf: number;
  /** Configured threshold, as a percentage. */
  threshold: number;
  /** `inline` sits in a table cell; `hero` is the detail screen's headline. */
  variant?: "inline" | "hero";
}

export function ConfidenceMeter({ conf, threshold, variant = "inline" }: ConfidenceMeterProps) {
  const pct = Math.round(conf * 100);
  const tone = toneFor(pct, threshold);
  const clears = pct >= threshold;
  const verdict = clears ? "Above threshold" : "Below threshold";
  const label = `Match confidence ${pct} percent, ${verdict.toLowerCase()} of ${threshold} percent`;

  if (variant === "hero") {
    return (
      <div className="py-1.5 text-center">
        <div className={cn("font-mono text-4xl font-semibold", tone.text)}>{pct}%</div>
        <p className="text-ink-3 mt-0.5 text-xs">
          match confidence · threshold {threshold}%
        </p>

        <div
          className="bg-surface-3 relative mt-3.5 h-1.5 overflow-hidden rounded-full"
          role="meter"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          {/* Width and marker offset are data, not design — they cannot be
              expressed as a static utility class. */}
          <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${pct}%` }} />
          <div
            className="bg-ink-3 absolute inset-y-0 w-0.5"
            style={{ left: `${threshold}%` }}
            aria-hidden
          />
        </div>

        <p className={cn("mt-2 text-xs font-semibold", tone.text)}>{verdict}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div
          className="bg-surface-3 h-1.5 w-12 shrink-0 overflow-hidden rounded-full"
          role="meter"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn("text-xs font-semibold", tone.text)}>{pct}%</span>
      </div>
      <span className="text-ink-3 text-[11px]" aria-hidden>
        {verdict}
      </span>
    </div>
  );
}
