import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Multi-value input, used three ways:
 *
 *  - **pick from a list** — pass `options`; type to filter, click to select
 *    (the regions dropdown);
 *  - **type your own** — pass `allowCustom`; press Enter to add what you typed;
 *  - **search a list too big to send** — pass `options` AND `onSearch`; the
 *    caller fetches matches and this stops filtering locally (the pincode
 *    picker, which searches 19,490 codes it could never hold).
 *
 * All three render the chosen values as removable chips inside the field, so
 * they read as one control. Built on Base UI's Combobox, which brings the
 * popup, filtering and chip keyboard navigation (Backspace deletes the last
 * chip) with it.
 */

export interface MultiSelectOption {
  value: string;
  label: string;
}

/** How long to wait after a keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 250;

interface MultiSelectProps {
  value: string[];
  onValueChange: (next: string[]) => void;
  /** Selectable options. Omit for a free-entry field. */
  options?: MultiSelectOption[];
  /** Allow values that aren't in `options`, added with Enter. */
  allowCustom?: boolean;
  /** Return an error message to reject a typed value, or null to accept it. */
  validateCustom?: (raw: string) => string | null;
  /** Tidy a typed value before validating (e.g. strip spaces). */
  normalizeCustom?: (raw: string) => string;
  /**
   * Async mode. Called (debounced) with what the user typed; the caller
   * fetches and passes the matches back as `options`.
   *
   * Supplying this turns OFF the combobox's own filtering — the server has
   * already done it, and filtering the page again would hide matches whose
   * label doesn't contain the query.
   */
  onSearch?: (query: string) => void;
  /** True while `onSearch` results are in flight. */
  loading?: boolean;
  /**
   * Fetch the next page. Called when the popup is scrolled near its end, and
   * never while `loadingMore` is true — the caller does not need to guard
   * against a burst of calls from one flick of the wheel.
   */
  onLoadMore?: () => void;
  /** Whether another page exists. Without it `onLoadMore` is never called. */
  hasMore?: boolean;
  /** True while the next page is in flight. */
  loadingMore?: boolean;
  /** Shown when the list is empty. Defaults to "Nothing left to add". */
  emptyMessage?: string;
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
  normalizeCustom,
  onSearch,
  loading = false,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  emptyMessage,
  placeholder,
  id,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: MultiSelectProps) {
  const [query, setQuery] = React.useState("");
  /** Values the last add refused — named so nothing disappears quietly. */
  const [rejected, setRejected] = React.useState<string[]>([]);
  /**
   * The last thing typed. The combobox blanks its own input *before* our blur
   * handler runs, so reading state there would see "" and conclude the user had
   * typed nothing — silently discarding what they entered.
   */
  const lastTyped = React.useRef("");
  /**
   * The combobox blanks its input right after an add. That blank must not be
   * mistaken for the user clearing the box, or it would erase the "not added"
   * complaint we just raised.
   */
  const selfCleared = React.useRef(false);

  /**
   * Split on separators only — NOT spaces — so a pasted "560001, 560002" adds
   * two values while a conventionally-spaced "560 001" stays one (the
   * normalizer then removes the space).
   */
  const tokenize = React.useCallback(
    (raw: string) =>
      raw
        .split(/[,;\n]+/)
        .map((t) => (normalizeCustom ? normalizeCustom(t) : t.trim()))
        .filter(Boolean),
    [normalizeCustom]
  );

  /**
   * Derived, not stored on Enter: the combobox clears its own input after a
   * keypress, which would wipe a stored error before it could be read. Deriving
   * from the current text also means the hint appears as you type.
   */
  const customError = React.useMemo(() => {
    if (!allowCustom) return null;
    for (const token of tokenize(query)) {
      const message = validateCustom?.(token);
      if (message) return message;
    }
    return null;
  }, [allowCustom, query, tokenize, validateCustom]);

  /**
   * Labels for values that are no longer in `options`.
   *
   * In async mode the option list is one page of search results, so a chip
   * chosen two searches ago would fall back to its raw value the moment the
   * list changed. Remembering every label seen keeps a chip reading
   * "500001 — Hyderabad" instead of decaying to "500001".
   */
  /**
   * A chosen value's label, falling back to the value itself.
   *
   * In async mode `options` is one page of search results, so a chip chosen
   * before the last search shows its raw value again. That is deliberate: the
   * only async consumer is the pincode picker, where the value IS a readable
   * six-digit code and the label only adds a district for recognition. Caching
   * every label seen would mean either a ref written during render or a
   * setState inside an effect — both of which the React Compiler rules refuse,
   * and neither is worth it to keep a district visible on a chip.
   */
  const labelOf = React.useCallback(
    (v: string) => options?.find((o) => o.value === v)?.label ?? v,
    [options]
  );

  /**
   * Ask the caller to search, once the typing pauses. Debounced here rather
   * than at each call site so every async consumer gets the same behaviour.
   *
   * Fires on an empty query too: clearing the box should restore the initial
   * list, not leave the last search's results on screen.
   */
  const hasSearch = Boolean(onSearch);
  const searchRef = React.useRef(onSearch);
  React.useEffect(() => {
    searchRef.current = onSearch;
  });

  /**
   * Load the next page as the popup nears its end.
   *
   * The guard is on `hasMore && !loadingMore`, so one flick of the wheel fires
   * a single fetch rather than one per scroll event — `onScroll` is chatty and
   * TanStack would happily queue a dozen identical page requests.
   *
   * 64px of runway rather than the exact bottom: it starts fetching while the
   * user is still reading, so the list usually grows before they reach the end.
   */
  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!onLoadMore || !hasMore || loadingMore) return;
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 64) onLoadMore();
    },
    [hasMore, loadingMore, onLoadMore]
  );
  React.useEffect(() => {
    if (!hasSearch) return;
    const id = window.setTimeout(
      () => searchRef.current?.(query.trim()),
      SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(id);
  }, [query, hasSearch]);

  // Never offer something already chosen.
  const available = React.useMemo(
    () => (options ?? []).filter((o) => !value.includes(o.value)),
    [options, value]
  );

  /**
   * Adds every valid value in the box and NAMES the ones it refused.
   *
   * The refused text can't simply be left in the input: the combobox clears its
   * own input after Enter, which would overwrite it and the entry would vanish
   * silently. Reporting them separately is what makes the loss visible.
   */
  function addCustom(viaEnter: boolean) {
    const source = query.trim() || lastTyped.current.trim();
    if (!source) return;

    const accepted: string[] = [];
    const bad: string[] = [];
    for (const token of tokenize(source)) {
      if (validateCustom?.(token)) bad.push(token);
      else if (!value.includes(token) && !accepted.includes(token))
        accepted.push(token);
    }
    if (accepted.length) onValueChange([...value, ...accepted]);

    // Tracked separately from the input on purpose: the combobox clears its own
    // input on both Enter and blur, so anything written back there is wiped —
    // and with it the evidence that a value was refused.
    setRejected(bad);
    lastTyped.current = bad.join(", ");
    selfCleared.current = true;
    if (viaEnter) setQuery("");
  }

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Combobox.Root
        multiple
        items={available}
        // The server already filtered; filtering the page again would hide a
        // match whose label doesn't literally contain what was typed.
        filter={onSearch ? null : undefined}
        value={value}
        onValueChange={(next) => onValueChange(next as string[])}
        inputValue={query}
        onInputValueChange={(next) => {
          setQuery(next);
          if (next) {
            lastTyped.current = next;
            setRejected([]); // typing again clears the last complaint
            return;
          }
          if (selfCleared.current) {
            // The combobox blanking itself after an add — keep the complaint.
            selfCleared.current = false;
            return;
          }
          // The user emptied the box: they've dealt with it, so let them on.
          lastTyped.current = "";
          setRejected([]);
        }}
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
                addCustom(true);
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
              if (allowCustom) addCustom(false);
            }}
            className="h-6 min-w-24 flex-1 border-none bg-transparent px-1 text-sm text-ink outline-none placeholder:text-muted-foreground"
          />
        </Combobox.Chips>

        {options ? (
          <Combobox.Portal>
            <Combobox.Positioner className="isolate z-50 outline-none" sideOffset={4}>
              <Combobox.Popup
                onScroll={handleScroll}
                className={cn(
                  // A real height cap, not just `--available-height`: that var
                  // is the room the positioner found, which on a tall screen is
                  // most of the viewport — so a long list simply grew off the
                  // bottom and never scrolled, and an infinite list could never
                  // reach its end to ask for more.
                  "max-h-72 w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none",
                  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
                )}
              >
                {/* In async mode an empty list usually means "still fetching",
                    and "Nothing left to add" would be a wrong answer shown
                    confidently for a few hundred milliseconds. */}
                <Combobox.Empty className="px-2 py-1.5 text-xs text-ink-3">
                  {loading
                    ? "Searching…"
                    : (emptyMessage ?? "Nothing left to add")}
                </Combobox.Empty>
                <Combobox.List>
                  {(item: MultiSelectOption) => (
                    <Combobox.Item
                      key={item.value}
                      value={item.value}
                      // hover AND data-highlighted, matching `select.tsx`.
                      // With `data-highlighted` alone a mouse user got no
                      // feedback at all — measured: the background stayed
                      // transparent under the pointer. Base UI drives that
                      // attribute from pointer MOVEMENT, so it also misses a
                      // stationary cursor, which this list hits often: the
                      // popup opens under a resting pointer and the options
                      // re-render beneath it on every search and page fetch.
                      // `data-highlighted` is kept, not replaced — it is what
                      // arrow-key navigation still uses.
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    >
                      <Combobox.ItemIndicator>
                        <Check className="size-3.5" aria-hidden />
                      </Combobox.ItemIndicator>
                      {item.label}
                    </Combobox.Item>
                  )}
                </Combobox.List>
                {/* A visible end to the list. Without it a popup that has
                    stopped growing looks identical to one still fetching. */}
                {loadingMore ? (
                  <p className="px-2 py-1.5 text-xs text-ink-3">Loading more…</p>
                ) : null}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        ) : null}
      </Combobox.Root>

      {customError ? (
        <p role="alert" className="text-xs text-danger">
          {customError}
        </p>
      ) : rejected.length ? (
        <p role="alert" className="text-xs text-danger">
          Not added: {rejected.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
