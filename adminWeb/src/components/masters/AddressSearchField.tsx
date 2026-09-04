import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { ADDRESS_SEARCH, type AddressSearch } from "./vendorSchema";

interface AddressSearchFieldProps {
  value: AddressSearch;
  onChange: (value: AddressSearch) => void;
  error?: string;
  errorId?: string;
}

/**
 * On / Off for the vendor portal's Google address search.
 *
 * The same two-card radio as `StatusField`, rather than a switch: there is no
 * `Switch` in this console, every other boolean here is one of these, and a
 * switch's two states carry no visible word — which would be colour alone.
 *
 * `StatusField` is deliberately NOT generalised to serve both. It is typed to
 * `CategoryStatus` and belongs to the product master; the house habit is to
 * promote a shared component on the third consumer, not the second.
 */
export function AddressSearchField({
  value,
  onChange,
  error,
  errorId,
}: AddressSearchFieldProps) {
  return (
    <FieldSet data-invalid={error ? true : undefined}>
      <FieldLegend variant="label" className="text-sm font-medium">
        Address search
      </FieldLegend>
      <RadioGroup
        aria-label="Address search"
        value={value}
        onValueChange={(next) => onChange(next as AddressSearch)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="grid grid-cols-2 gap-2.5"
      >
        {ADDRESS_SEARCH.map((s) => (
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
      <FieldDescription>
        When on, this vendor's portal offers a Google address search on the
        ticket form. When off, they type the address in by hand.
      </FieldDescription>
      {error ? (
        <FieldDescription id={errorId} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : null}
    </FieldSet>
  );
}
