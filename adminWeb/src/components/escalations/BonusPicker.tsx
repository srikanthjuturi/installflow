import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "@/utils/money";

interface BonusPickerProps {
  /**
   * The bands to offer, in RUPEES, ascending. Served from Rules configuration
   * rather than defaulted here: a default would be a second declaration of the
   * amounts, and the one that never gets edited is the one that goes stale.
   * The API takes paise; the page converts at that boundary, not in here.
   */
  amounts: readonly number[];
  /** The band currently funded. */
  value: number;
  onChange: (amount: number) => void;
  disabled?: boolean;
}

/**
 * A single-choice row of bonus chips.
 *
 * It is a group of toggle buttons rather than a radio group because the
 * prototype's chips are buttons: pressing one immediately re-prices the
 * confirm action in the footer. `aria-pressed` carries the selection, and the
 * chosen chip also shows a tick — the fill alone would signal state by colour.
 *
 * No band is disabled. It used to take a `max` and grey out anything above the
 * "available pool", but §7's pool is funded by collected cancellation
 * penalties and nothing collects them yet — so the ceiling was a number with
 * no source, and greying out a real option against an invented limit is worse
 * than offering all four. The cap comes back with the ledger.
 */
export function BonusPicker({
  amounts,
  value,
  onChange,
  disabled = false,
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

          return (
            <button
              key={amount}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
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
