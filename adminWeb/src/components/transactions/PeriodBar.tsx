import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  istToday,
  rangeProblem,
  type DateRange,
  type PeriodPreset,
} from "@/lib/transactionPeriod";
import { formatDate } from "@/utils/datetime";

/**
 * The date range: preset chips and, for Custom, two date boxes. Dates are IST
 * calendar days (`lib/transactionPeriod`). The bar only reports intent - the
 * URL is the state.
 *
 * `min`/`max` cross-bind the custom pair, so a range ending before it starts
 * cannot be typed; the three-year ceiling is stated rather than silently
 * clamped because the statement endpoint refuses anything longer.
 */
export function PeriodBar({
  preset,
  range,
  onPreset,
  onCustom,
}: {
  preset: PeriodPreset;
  range: DateRange;
  onPreset: (preset: PeriodPreset) => void;
  onCustom: (range: DateRange) => void;
}) {
  const problem = preset === "custom" ? rangeProblem(range) : null;
  const today = istToday();
  return (
    <div className="mb-4 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Date range"
          className="flex flex-wrap items-center gap-1.5"
        >
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => onPreset(p)}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                preset === p
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-input bg-surface text-ink-2 hover:bg-surface-2"
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {preset === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="From"
              className="h-8 w-40"
              value={range.from}
              max={range.to || today}
              onChange={(e) => onCustom({ from: e.target.value, to: range.to })}
            />
            <span className="text-[13px] text-ink-3">to</span>
            <Input
              type="date"
              aria-label="To"
              className="h-8 w-40"
              value={range.to}
              min={range.from}
              onChange={(e) => onCustom({ from: range.from, to: e.target.value })}
            />
          </div>
        ) : (
          <span className="text-[13px] text-ink-3">
            {formatDate(range.from)} – {formatDate(range.to)}
          </span>
        )}
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
