import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
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
}

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
}: ToolbarProps<T>) {
  if (!search && filters.length === 0 && !actions) return null;

  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      {search ? (
        <div className="bg-surface border-line flex h-10 min-w-55 flex-1 items-center gap-2 rounded-md border px-3">
          <Search className="text-ink-3 size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            aria-controls={tableId}
            className="text-ink w-full border-none bg-transparent text-[13px] outline-none"
          />
        </div>
      ) : null}

      {filters.map((f) => {
        const value = filterValue(f);
        const all = f.allValue ?? "All";

        // A short option set reads better as pills — they show every choice at
        // once, which a select hides behind an interaction.
        if ((f.variant ?? (f.options.length <= 7 ? "pills" : "select")) === "pills") {
          return (
            <div key={f.id} className="flex flex-wrap gap-2.5" role="group" aria-label={f.label}>
              {f.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={value === o.value}
                  aria-controls={tableId}
                  onClick={() => onFilter(f, o.value)}
                  className={cn(
                    "h-10 rounded-md border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
                    value === o.value
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-line bg-surface text-ink-2 hover:border-brand-400 hover:text-ink",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          );
        }

        return (
          <Select key={f.id} value={value} onValueChange={(v) => onFilter(f, v ?? all)}>
            <SelectTrigger className="h-10 w-48" aria-label={f.label}>
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

      {actions ? <div className="flex flex-wrap gap-2.5">{actions}</div> : null}
    </div>
  );
}
