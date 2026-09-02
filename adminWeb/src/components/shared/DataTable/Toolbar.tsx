import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TypedFilterDef } from "./types";

interface ToolbarProps<T> {
  search?: { placeholder: string };
  query: string;
  onQuery: (v: string) => void;
  filters: Array<TypedFilterDef<T>>;
  filterValue: (f: TypedFilterDef<T>) => string;
  onFilter: (f: TypedFilterDef<T>, v: string) => void;
  actions?: React.ReactNode;
  tableId: string;
  /** Rows-per-page lives here, beside the other controls that narrow the view. */
  pageSize?: { value: number; sizes: number[]; onChange: (n: number) => void };
}

/**
 * The toolbar is TWO ZONES, and the split is what the layout is about.
 *
 * On the left, the one control that takes free text. On the right, everything
 * that narrows or acts on the list — the filters, the Rows picker, the page's
 * own buttons — pushed to the right edge by the spacer between them. That is
 * the conventional shape for a table toolbar, and it also settles an argument
 * the old row kept having with itself: with the filters spread across the full
 * width, their size depended on how many of them a given screen happened to
 * have, so no two screens' filters measured the same.
 *
 * One treatment for all of it. The row used to carry three at once: the search
 * box white with a faint `--border` edge, the filters transparent with a darker
 * `--input` edge, and the outline button the page's own colour. Everything here
 * is a control, so everything gets the white surface and the `--input` edge the
 * theme reserves for a field — see the note beside `--input` in `theme.css`.
 */
const CONTROL = "h-10 border-input bg-surface";

/**
 * The left zone. It grows into the free space up to a cap, so its placeholder
 * comes back on a roomy screen instead of clipping mid-word — and then STOPS,
 * because a search field eight hundred pixels wide is not a better search
 * field. Past the cap the right-hand group takes the rest, which is what turns
 * the leftover into a clean gap rather than one enormous input.
 */
const SEARCH = `${CONTROL} min-w-0 grow basis-40 max-w-80`;

/**
 * The right zone. Fixed and identical for every filter, select or combobox
 * alike, so the group reads as one set of controls rather than boxes of
 * assorted sizes — and so no filter's width depends on how many filters happen
 * to sit beside it on that particular screen.
 *
 * `w-40` is sized for the longest label the console actually has, "Intake
 * channel: all" on Vendors; shorter ones simply carry more air. `shrink-0`
 * because a filter that squeezes to fit is a filter whose label you cannot
 * read — wrapping to the next line is the better failure.
 */
const FILTER = `${CONTROL} w-40 shrink-0`;

/** Search, filters and page actions. Renders nothing if it would be empty. */
export function Toolbar<T>({
  search,
  query,
  onQuery,
  filters,
  filterValue,
  onFilter,
  actions,
  tableId,
  pageSize,
}: ToolbarProps<T>) {
  if (!search && filters.length === 0 && !actions && !pageSize) return null;

  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2">
      {search ? (
        <div
          className={cn(
            SEARCH,
            "flex items-center gap-2 rounded-lg border px-3"
          )}
        >
          <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            aria-controls={tableId}
            className="w-full border-none bg-transparent text-[13px] text-ink outline-none"
          />
        </div>
      ) : null}

      {/* The right zone is ONE flex item, not a run of loose siblings, and the
          two classes on it are what right-align the toolbar.

          `grow` makes it claim the space the search box does not want, so its
          contents — pushed over by `justify-end` — end at the row's right edge.
          The empty middle is this element's own slack rather than a spacer
          element, and it is also why an `ml-auto` would be wrong: an auto
          margin eats free space BEFORE flex-grow runs, which would freeze the
          search box at its basis forever instead of letting it grow into its
          cap first.

          Being one item matters just as much at the width where everything
          stops fitting. As loose siblings the row broke wherever the last
          control happened to fall and dropped the page's buttons onto a second
          line flush LEFT, stranded under the search box — which is where this
          whole layout started. A `grow` group fills whatever line it lands on,
          so every line it wraps into stays pinned right. */}
      <div className="flex min-w-0 grow flex-wrap items-center justify-end gap-2">
        {filters.map((f) => {
          const value = filterValue(f);
          const all = f.allValue ?? "All";

          // Too long to scroll: type to narrow, and the list pages as it goes.
          if (f.variant === "combobox") {
            const chosen = f.options.find((o) => o.value === value);
            return (
              <Combobox
                key={f.id}
                className={FILTER}
                // Held as an object because Base UI reads `.label` off it to
                // fill the input; `All` is the cleared state, so it is null.
                value={
                  value === all || !chosen
                    ? null
                    : { value: chosen.value, label: chosen.label }
                }
                onValueChange={(next) => onFilter(f, next?.value ?? all)}
                options={f.options}
                onSearch={f.onSearch}
                onLoadMore={f.onLoadMore}
                hasMore={f.hasMore}
                loading={f.loading}
                loadingMore={f.loadingMore}
                // Names the dimension when empty, exactly as the select does —
                // two blank boxes tell you nothing about what they filter.
                placeholder={`${f.label}: all`}
                emptyMessage={`No ${f.label.toLowerCase()} matches`}
                aria-describedby={undefined}
              />
            );
          }

          // A short option set reads better as pills — they show every choice at
          // once, which a select hides behind an interaction.
          if (
            (f.variant ?? (f.options.length <= 7 ? "pills" : "select")) ===
            "pills"
          ) {
            // Without a clear option a pill filter can be set but never undone.
            const pills = f.options.some((o) => o.value === all)
              ? f.options
              : [{ value: all, label: f.allLabel ?? all }, ...f.options];
            return (
              <div
                key={f.id}
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={f.label}
              >
                {pills.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={value === o.value}
                    aria-controls={tableId}
                    onClick={() => onFilter(f, o.value)}
                    className={cn(
                      "h-10 rounded-lg border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
                      value === o.value
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-input bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            );
          }

          return (
            <Select
              key={f.id}
              value={value}
              onValueChange={(v) => onFilter(f, v ?? all)}
            >
              <SelectTrigger className={FILTER} aria-label={f.label}>
                {/* Name the dimension, not just the value — two selects both
                  reading "All" tell you nothing about what they filter. */}
                <SelectValue>
                  {value === all ? (
                    <span className="text-ink-3">{f.label}: all</span>
                  ) : (
                    <span>
                      <span className="text-ink-3">{f.label}: </span>
                      {f.options.find((o) => o.value === value)?.label ?? value}
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={all}>{f.label}: all</SelectItem>
                  {f.options
                    .filter((o) => o.value !== all)
                    .map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          );
        })}

        {/* Both of these keep their natural width — their content is fixed, so
            the slack belongs to the search box and the spacer instead. */}
        {pageSize ? (
          <div className="flex shrink-0 items-center gap-2 text-xs text-ink-2">
            <label htmlFor={`${tableId}-size`} className="whitespace-nowrap">
              Rows
            </label>
            <Select
              value={String(pageSize.value)}
              onValueChange={(v) =>
                pageSize.onChange(Number(v ?? pageSize.value))
              }
            >
              <SelectTrigger
                id={`${tableId}-size`}
                className={cn(CONTROL, "w-20")}
                aria-controls={tableId}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {pageSize.sizes.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {actions ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
