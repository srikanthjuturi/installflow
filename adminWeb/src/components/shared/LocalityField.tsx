import * as React from "react";
import { Loader2 } from "lucide-react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { PostOffice } from "@/types/geo";

/**
 * "Local area" — a text box that SUGGESTS the post offices of the pincode.
 *
 * Deliberately not `ui/combobox`: that one is a picker whose value must be one
 * of its options, and the directory here is only a suggestion list. Anything
 * typed is a valid answer (the server stores free text), so the box owns a
 * plain string and the list merely offers to fill it.
 *
 * Presentational — the caller (AddressFields) fetches the offices and decides
 * when the list may be offered.
 */

export interface LocalityFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Already ordered by the server — delivering offices first. Shown as given. */
  offices: PostOffice[];
  loading?: boolean;
  idPrefix: string;
  error?: string;
  disabled?: boolean;
  label?: string;
}

export function LocalityField({
  value,
  onChange,
  offices,
  loading = false,
  idPrefix,
  error,
  disabled,
  label = "Local area",
}: LocalityFieldProps) {
  const id = `${idPrefix}-locality`;
  const listId = `${id}-list`;
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);

  // Once the text is exactly an office, show the whole list again — otherwise a
  // person who picked one and reopens the box sees only that one row.
  const shown = React.useMemo(() => {
    const typed = value.trim().toLowerCase();
    if (!typed || offices.some((o) => o.name.toLowerCase() === typed))
      return offices;
    return offices.filter((o) => o.name.toLowerCase().includes(typed));
  }, [offices, value]);

  const listVisible = open && !disabled && (loading || shown.length > 0);

  function pick(office: PostOffice) {
    onChange(office.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!shown.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % shown.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? shown.length - 1 : i - 1));
    } else if (event.key === "Enter" && listVisible && active >= 0) {
      // Only swallow Enter when it is choosing a row — otherwise it must still
      // submit the form like it does in any other box.
      event.preventDefault();
      const office = shown[active];
      if (office) pick(office);
    }
  }

  const hasHint = !loading && offices.length === 0 && !error;
  const describedBy = error ? `${id}-error` : hasHint ? `${id}-hint` : undefined;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={listVisible}
          aria-controls={listVisible ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            listVisible && active >= 0 ? `${id}-opt-${active}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          maxLength={80}
          value={value}
          disabled={disabled}
          // With no suggestions the hint underneath says it; repeating it as a
          // placeholder would be the same words twice.
          placeholder={offices.length > 0 ? "Pick or type your area" : undefined}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {loading ? (
          <Loader2
            className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-ink-3"
            aria-hidden
          />
        ) : null}
        {listVisible ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {loading && shown.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-ink-3">Loading areas…</li>
            ) : null}
            {shown.map((office, index) => (
              <li
                key={office.id}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={value.trim() === office.name}
                data-highlighted={index === active ? true : undefined}
                // mousedown, not click: the input's blur would close the list
                // before a click could land.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(office);
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm select-none hover:bg-accent hover:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              >
                <span className="truncate">{office.name}</span>
                {office.delivers ? null : (
                  <span className="shrink-0 text-xs text-ink-3">
                    (no delivery)
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {hasHint ? (
        <FieldDescription id={`${id}-hint`}>Type your area</FieldDescription>
      ) : null}
      {error ? (
        <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : null}
    </Field>
  );
}
