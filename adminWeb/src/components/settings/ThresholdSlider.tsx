import { Skeleton } from "@/components/ui/skeleton";

/**
 * The AI verification confidence threshold.
 *
 * Below this figure a proof set is not auto-closed — it is flagged for manual
 * ASM review. (An *unreadable* image is a separate outcome: the technician is
 * prompted to retake it on site, before leaving.)
 *
 * A native `<input type="range">` rather than a new dependency: it is keyboard
 * and screen-reader complete out of the box, and `accent-*` tints it from the
 * same brand token as everything else.
 */

const HINT_ID = "ai-threshold-hint";
const INPUT_ID = "ai-threshold";

interface ThresholdSliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function ThresholdSlider({
  value,
  min,
  max,
  onChange,
  disabled,
}: ThresholdSliderProps) {
  return (
    <div>
      <p id={HINT_ID} className="text-ink-3 mb-4 text-xs">
        Below this confidence, tickets are flagged for manual ASM review.
      </p>

      {/* The value is readable as text, not only as a knob position. */}
      <p className="flex items-baseline gap-1.5">
        <span className="text-brand-500 text-[40px] leading-none font-semibold tabular-nums">
          {value}
        </span>
        <span className="text-ink-3 text-lg">%</span>
      </p>

      <label htmlFor={INPUT_ID} className="sr-only">
        AI verification threshold
      </label>
      <input
        id={INPUT_ID}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-describedby={HINT_ID}
        aria-valuetext={`${value} percent`}
        className="accent-brand-500 mt-3 w-full"
      />

      <div className="text-ink-3 mt-1 flex justify-between text-[11px]">
        <span>{min}% · lenient</span>
        <span>{max}% · strict</span>
      </div>

      <p className="border-line-2 bg-surface-2 text-ink-2 mt-3.5 rounded-md border px-3.25 py-2.75 text-xs">
        Unreadable image → technician prompted to retake on-site.
      </p>
    </div>
  );
}

export function ThresholdSliderSkeleton() {
  return (
    <div>
      <Skeleton className="h-3 w-full max-w-72" />
      <Skeleton className="mt-4 h-10 w-24" />
      <Skeleton className="mt-3 h-4 w-full rounded-full" />
      <div className="mt-1 flex justify-between">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-16" />
      </div>
      <Skeleton className="mt-3.5 h-10 rounded-md" />
    </div>
  );
}
