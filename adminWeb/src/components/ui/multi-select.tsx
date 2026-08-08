import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Multi-value input, used two ways:
 *
 *  - **pick from a list** — pass `options`; type to filter, click to select
 *    (the regions dropdown);
 *  - **type your own** — pass `allowCustom`; press Enter to add what you typed
 *    (the pincode input).
 *
 * Both render the chosen values as removable chips below/inside the field, so
 * the two controls read as one thing. Built on Base UI's Combobox, which brings
 * the popup, filtering and chip keyboard navigation (Backspace deletes the last
 * chip) with it.
 */

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  value: string[];
  onValueChange: (next: string[]) => void;
  /** Selectable options. Omit for a free-entry field. */
  options?: MultiSelectOption[];
  /** Allow values that aren't in `options`, added with Enter. */
  allowCustom?: boolean;
  /** Return an error message to reject a typed value, or null to accept it. */
  validateCustom?: (raw: string) => string | null;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export function MultiSelect({
  value,
  onValueChange,
  options,
  allowCustom = false,
  validateCustom,
  placeholder,
  id,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: MultiSelectProps) {
  const [query, setQuery] = React.useState("");

  /**
   * Derived, not stored on Enter: the combobox clears its own input after a
   * keypress, which would wipe a stored error before it could be read. Deriving
   * from the current text also means the hint appears as you type.
   */
  const customError =
    allowCustom && query.trim() ? (validateCustom?.(query.trim()) ?? null) : null;

  const labelOf = React.useCallback(
    (v: string) => options?.find((o) => o.value === v)?.label ?? v,
    [options]
  );

  // Never offer something already chosen.
  const available = React.useMemo(
    () => (options ?? []).filter((o) => !value.includes(o.value)),
    [options, value]
  );

  function addCustom() {
    const raw = query.trim();
    // Nothing typed, or it failed validation — the message is already showing.
    if (!raw || validateCustom?.(raw)) return;
    setQuery("");
    if (!value.includes(raw)) onValueChange([...value, raw]);
  }

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Combobox.Root
        multiple
        items={available}
        value={value}
        onValueChange={(next) => onValueChange(next as string[])}
        inputValue={query}
        onInputValueChange={(next) => setQuery(next)}
        disabled={disabled}
      >
        <Combobox.Chips
          data-slot="multi-select"
          className={cn(
            "flex min-h-8 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 transition-colors",
            "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
            ariaInvalid && "border-destructive ring-3 ring-destructive/20",
            disabled && "pointer-events-none opacity-50"
          )}
        >
          {value.map((v) => (
            <Combobox.Chip
              key={v}
              data-slot="multi-select-chip"
              className="inline-flex items-center gap-1 rounded-md bg-surface-3 py-0.5 pr-0.5 pl-2 text-xs font-medium text-ink-2 data-highlighted:bg-brand-100 data-highlighted:text-brand-500"
            >
              {labelOf(v)}
              <Combobox.ChipRemove
                aria-label={`Remove ${labelOf(v)}`}
                className="grid size-4 place-items-center rounded text-ink-3 transition-colors hover:text-danger"
              >
                <X className="size-3" aria-hidden />
              </Combobox.ChipRemove>
            </Combobox.Chip>
          ))}
          <Combobox.Input
            id={id}
            placeholder={value.length ? undefined : placeholder}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={ariaDescribedBy}
            onKeyDown={(event) => {
              if (allowCustom && event.key === "Enter") {
                // Enter means "add what I typed", not "submit the form".
                event.preventDefault();
                addCustom();
                return;
              }
              if (
                event.key === "Backspace" &&
                query === "" &&
                value.length > 0
              ) {
                onValueChange(value.slice(0, -1));
              }
            }}
            onBlur={() => {
              if (allowCustom) addCustom();
            }}
            className="h-6 min-w-24 flex-1 border-none bg-transparent px-1 text-sm text-ink outline-none placeholder:text-muted-foreground"
          />
        </Combobox.Chips>

        {options ? (
          <Combobox.Portal>
            <Combobox.Positioner className="isolate z-50 outline-none" sideOffset={4}>
              <Combobox.Popup
                className={cn(
                  "max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none",
                  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
                )}
              >
                <Combobox.Empty className="px-2 py-1.5 text-xs text-ink-3">
                  Nothing left to add
                </Combobox.Empty>
                <Combobox.List>
                  {(item: MultiSelectOption) => (
                    <Combobox.Item
                      key={item.value}
                      value={item.value}
                      className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    >
                      <Combobox.ItemIndicator>
                        <Check className="size-3.5" aria-hidden />
                      </Combobox.ItemIndicator>
                      {item.label}
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        ) : null}
      </Combobox.Root>

      {customError ? (
        <p role="alert" className="text-xs text-danger">
          {customError}
        </p>
      ) : null}
    </div>
  );
}
