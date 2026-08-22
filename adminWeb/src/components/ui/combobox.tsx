import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Single-value combobox — the sibling of `multi-select.tsx`.
 *
 * That component is chips-only, and a chip is the wrong shape for a field that
 * holds exactly one answer. Everything else here is lifted from it deliberately
 * rather than re-derived, because each piece was paid for once already: the
 * debounce lives inside the component so every async consumer behaves the same,
 * `filter={null}` turns off local filtering when the server has already
 * filtered, the popup gets a real height cap, and items respond to `hover` as
 * well as `data-highlighted`.
 *
 * Two ways to use it:
 *
 *  - **pick from a list** — pass `options`; the combobox filters them itself;
 *  - **search a list too big to send** — pass `options` AND `onSearch`; the
 *    caller fetches matches and this stops filtering locally (the address
 *    autocomplete, whose options come from Google a query at a time).
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** A dimmer second line under the label — a district, a region, a country. */
  hint?: string;
}

/** How long to wait after a keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 250;

interface ComboboxProps {
  /** The chosen option, or null. Objects, not ids — Base UI reads `.label`
   *  off the value to fill the input. */
  value: ComboboxOption | null;
  onValueChange: (next: ComboboxOption | null) => void;
  options: ComboboxOption[];
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
  /**
   * Highlight the first match as the user types, so Enter picks it.
   *
   * For a field where what they type IS the answer — a pincode — this is the
   * difference between "type 500001, press Enter" and "type 500001, then hunt
   * for the mouse".
   */
  autoHighlight?: boolean;
  /** Shown when the list is empty. */
  emptyMessage?: string;
  placeholder?: string;
  /** Sits inside the field, before the input. Decorative — mark it aria-hidden. */
  icon?: React.ReactNode;
  id?: string;
  name?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export function Combobox({
  value,
  onValueChange,
  options,
  onSearch,
  loading = false,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  autoHighlight = false,
  emptyMessage,
  placeholder,
  icon,
  id,
  name,
  autoComplete,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: ComboboxProps) {
  /**
   * What was last typed — the search term, NOT the input's displayed text.
   *
   * `inputValue` is deliberately left uncontrolled. Base UI fills the input
   * from the selected value's `label` on its own, and controlling it here
   * broke exactly that: a value set from outside (the address autocomplete
   * writing a pincode it got from Google) changed `value` while the box went
   * on showing whatever had been typed, which was usually nothing.
   */
  const [query, setQuery] = React.useState("");

  /**
   * Base UI fills the input with the chosen label on selection, which fires
   * `onInputValueChange` like any keystroke would. Without this the pick would
   * immediately schedule a search for the text it just wrote — one wasted
   * round trip per selection, and on a metered API that is a real cost.
   */
  const filledByUs = React.useRef<string | null>(null);

  const hasSearch = Boolean(onSearch);
  const searchRef = React.useRef(onSearch);
  React.useEffect(() => {
    searchRef.current = onSearch;
  });

  React.useEffect(() => {
    if (!hasSearch) return;
    if (filledByUs.current !== null && filledByUs.current === query) return;
    const timer = window.setTimeout(
      () => searchRef.current?.(query.trim()),
      SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timer);
  }, [query, hasSearch]);

  /**
   * Load the next page as the popup nears its end.
   *
   * The guard is on `hasMore && !loadingMore`, so one flick of the wheel fires
   * a single fetch rather than one per scroll event. 64px of runway rather than
   * the exact bottom: it starts fetching while the user is still reading.
   */
  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!onLoadMore || !hasMore || loadingMore) return;
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 64) onLoadMore();
    },
    [hasMore, loadingMore, onLoadMore]
  );

  return (
    <ComboboxPrimitive.Root<ComboboxOption>
      items={options}
      // The server already filtered; filtering the page again would hide a
      // match whose label doesn't literally contain what was typed.
      filter={onSearch ? null : undefined}
      value={value}
      onValueChange={(next) => {
        onValueChange(next);
        filledByUs.current = next?.label ?? null;
      }}
      // Options are rebuilt on every search, so two objects for the same place
      // are never the same reference and `Object.is` would lose the selection.
      isItemEqualToValue={(a, b) => a.value === b.value}
      onInputValueChange={(next) => setQuery(next)}
      autoHighlight={autoHighlight}
      disabled={disabled}
    >
      <div
        data-slot="combobox"
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          ariaInvalid && "border-destructive ring-3 ring-destructive/20",
          disabled && "pointer-events-none opacity-50",
          className
        )}
      >
        {icon ? (
          <span className="shrink-0 text-ink-3" aria-hidden>
            {icon}
          </span>
        ) : null}
        <ComboboxPrimitive.Input
          id={id}
          name={name}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          className="h-6 min-w-0 flex-1 border-none bg-transparent text-base text-ink outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {/* Spinner and clear share the slot: while a search is in flight there
            is nothing to clear yet, and once results are in the spinner is
            gone — so they can never both want the space. */}
        {loading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-3" aria-hidden />
        ) : (
          <ComboboxPrimitive.Clear
            aria-label="Clear"
            className="grid size-4 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:text-danger"
          >
            <X className="size-3.5" aria-hidden />
          </ComboboxPrimitive.Clear>
        )}
      </div>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          className="isolate z-50 outline-none"
          sideOffset={4}
        >
          <ComboboxPrimitive.Popup
            onScroll={handleScroll}
            className={cn(
              // A real height cap, not `--available-height`: that var is the
              // room the positioner found, which on a tall screen is most of
              // the viewport — so a long list simply grew off the bottom and
              // never scrolled.
              "max-h-72 w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            )}
          >
            {/* In async mode an empty list usually means "still fetching", and
                the empty message would be a wrong answer shown confidently for
                a few hundred milliseconds. */}
            <ComboboxPrimitive.Empty className="px-2 py-1.5 text-xs text-ink-3">
              {loading ? "Searching…" : (emptyMessage ?? "No matches")}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {(item: ComboboxOption) => (
                <ComboboxPrimitive.Item
                  key={item.value}
                  value={item}
                  // hover AND data-highlighted, matching `multi-select.tsx`:
                  // Base UI drives `data-highlighted` from pointer MOVEMENT, so
                  // a stationary cursor over a list that re-renders beneath it
                  // — which is every search result here — gets no feedback.
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <ComboboxPrimitive.ItemIndicator className="mt-0.5">
                    <Check className="size-3.5" aria-hidden />
                  </ComboboxPrimitive.ItemIndicator>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="truncate text-xs text-ink-3">
                        {item.hint}
                      </span>
                    ) : null}
                  </span>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
            {/* A visible end to the list. Without it a popup that has stopped
                growing looks identical to one still fetching. */}
            {loadingMore ? (
              <p className="px-2 py-1.5 text-xs text-ink-3">Loading more…</p>
            ) : null}
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
