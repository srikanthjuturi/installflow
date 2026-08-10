import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { CATEGORY_STATUSES, type CategoryStatus } from "./categorySchema";

interface StatusFieldProps {
  value: CategoryStatus;
  onChange: (value: CategoryStatus) => void;
  /** What a Paused row stops doing — different at each level of the tree. */
  description: string;
  error?: string;
  errorId?: string;
}

/**
 * Active / Paused, shared by all three product-master forms.
 *
 * Extracted because the same two-card radio appears at every level of the tree
 * and only its description differs — three copies would drift the moment one of
 * them gained a state.
 */
export function StatusField({
  value,
  onChange,
  description,
  error,
  errorId,
}: StatusFieldProps) {
  return (
    <FieldSet data-invalid={error ? true : undefined}>
      <FieldLegend variant="label" className="text-sm font-medium">
        Status
      </FieldLegend>
      <RadioGroup
        aria-label="Status"
        value={value}
        onValueChange={(next) => onChange(next as CategoryStatus)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="grid grid-cols-2 gap-2.5"
      >
        {CATEGORY_STATUSES.map((s) => (
          <label
            key={s}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-[13px] transition-colors",
              value === s
                ? "border-brand-500 bg-brand-100/40"
                : "border-line hover:border-brand-400"
            )}
          >
            <RadioGroupItem value={s} />
            <span>{s}</span>
          </label>
        ))}
      </RadioGroup>
      <FieldDescription>{description}</FieldDescription>
      {error ? (
        <FieldDescription id={errorId} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : null}
    </FieldSet>
  );
}
