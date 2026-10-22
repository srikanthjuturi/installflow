import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { statementMonths } from "./statements";

interface StatementMonthPickerProps {
  /** The wire value the page holds — `2026-09`. */
  value: string;
  onChange: (value: string) => void;
  /** Disabled while the month's statement download is a no-op anyway. */
  disabled?: boolean;
}

/**
 * The statements toolbar's month picker (§5.5).
 *
 * A CONTROLLED select, not a URL-owning one: it lives in a table's toolbar on
 * this screen and is re-used from the technician profile page (§5.10), where
 * there is no list URL to write — so neither caller teaches it the router. The
 * page owns `?month=`; the picker owns the choice.
 *
 * The options come from `statementMonths` and are computed each render with
 * today's date — the picker sits above nothing, so "October 2026 (so far)"
 * stays correct across a page left open over a midnight.
 */
export function StatementMonthPicker({
  value,
  onChange,
  disabled,
}: StatementMonthPickerProps) {
  const months = statementMonths();

  return (
    // Base UI types the change as `string | null` (a clearing select can send
    // null); every option here names a real month, so null is merely the
    // type's honesty and is dropped.
    <Select
      value={value}
      onValueChange={(v: string | null) => v && onChange(v)}
      disabled={disabled}
    >
      {/* `w-40` — wider than most trigger defaults, because "September 2026
          (so far)" is the longest label the picker can hold. */}
      <SelectTrigger className="w-40" aria-label="Statement month">
        {/* Name the dimension, not just the value — a select reading
            "September 2026" alone tells you nothing about what it changes
            (the same reasoning `NotificationToolbar` records). */}
        <SelectValue>
          <span>
            <span className="text-ink-3">Month: </span>
            {months.find((m) => m.value === value)?.label ?? value}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {months.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}