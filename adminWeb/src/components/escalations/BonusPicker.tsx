import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "@/utils/money";

/** The four approved bands. Every one is drawn from the penalty pool. */
const BONUS_AMOUNTS = [200, 400, 600, 800] as const;

interface BonusPickerProps {
  amounts?: readonly number[];
  /** The band currently funded. */
  value: number;
  onChange: (amount: number) => void;
  disabled?: boolean;
  /** Nothing above this is payable — the pool is the only source of funds. */
  max?: number;
}

/**
 * A single-choice row of bonus chips.
 *
 * It is a group of toggle buttons rather than a radio group because the
 * prototype's chips are buttons: pressing one immediately re-prices the
 * confirm action in the footer. `aria-pressed` carries the selection, and the
 * chosen chip also shows a tick — the fill alone would signal state by colour.
 */
export function BonusPicker({
  amounts = BONUS_AMOUNTS,
  value,
  onChange,
  disabled = false,
  max,
}: BonusPickerProps) {
  return (
    <div>
      <span
        id="bonus-amount-label"
        className="mb-1.5 block text-xs font-semibold text-ink-2"
      >
        Bonus amount
      </span>

      <div
        role="group"
        aria-labelledby="bonus-amount-label"
        className="flex flex-wrap gap-2.5"
      >
        {amounts.map((amount) => {
          const selected = amount === value;
          const unfunded = typeof max === "number" && amount > max;

          return (
            <button
              key={amount}
              type="button"
              aria-pressed={selected}
              disabled={disabled || unfunded}
              onClick={() => onChange(amount)}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-lg border px-5 text-sm font-semibold transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                selected
                  ? "border-brand-500 bg-brand-500 text-primary-foreground"
                  : "border-line bg-surface text-ink hover:bg-surface-2"
              )}
            >
              {selected ? <Check className="size-4" aria-hidden /> : null}
              {money(amount)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
