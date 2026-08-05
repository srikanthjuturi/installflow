import { useMemo, useState } from "react";
import type { Column, SortState, SortValue, TypedFilterDef } from "./types";

const collator = new Intl.Collator("en-IN", { numeric: true, sensitivity: "base" });

/** `null` always sorts last, in both directions — a blank is not a small value. */
function compare(a: SortValue, b: SortValue): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

interface Args<T> {
  data?: T[];
  columns: Column<T>[];
  filters?: Array<TypedFilterDef<T>>;
  search?: {
    keys?: Array<keyof T>;
    fn?: (row: T, query: string) => boolean;
    value?: string;
    onChange?: (value: string) => void;
  };
  defaultSort?: SortState;
  pageSizeDefault: number;
  paginated: boolean;
}

/**
 * All table state in one place: query, filters, sort, page.
 *
 * Search and each filter can be controlled by the caller (the ticket list keeps
 * them in the URL so a filtered view is shareable) or left to the table.
 */
export function useDataTable<T>({
  data,
  columns,
  filters,
  search,
  defaultSort,
  pageSizeDefault,
  paginated,
}: Args<T>) {
  const [innerQuery, setInnerQuery] = useState("");
  const [innerFilters, setInnerFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState | undefined>(defaultSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeDefault);

  const query = search?.value ?? innerQuery;
  const setQuery = search?.onChange ?? setInnerQuery;

  const filterValue = (f: TypedFilterDef<T>) =>
    f.value ?? innerFilters[f.id] ?? f.allValue ?? "All";

  const setFilterValue = (f: TypedFilterDef<T>, v: string) =>
    f.onChange ? f.onChange(v) : setInnerFilters((prev) => ({ ...prev, [f.id]: v }));

  // Every column's sortValue, keyed for O(1) lookup during sort.
  const sortable = useMemo(
    () => new Map(columns.filter((c) => c.sortValue).map((c) => [c.id, c.sortValue!])),
    [columns],
  );

  const filtered = useMemo(() => {
    let rows = data ?? [];

    for (const f of filters ?? []) {
      const v = filterValue(f);
      const all = f.allValue ?? "All";
      if (v && v !== all) rows = rows.filter((r) => f.match(r, v));
    }

    const q = query.trim().toLowerCase();
    if (q && search) {
      rows = rows.filter((row) =>
        search.fn
          ? search.fn(row, q)
          : (search.keys ?? []).some((k) => String(row[k] ?? "").toLowerCase().includes(q)),
      );
    }

    if (sort) {
      const get = sortable.get(sort.columnId);
      if (get) {
        const dir = sort.dir === "asc" ? 1 : -1;
        // Copy first: sorting `rows` in place would mutate the query cache
        // when no filter narrowed it.
        rows = [...rows].sort((a, b) => compare(get(a), get(b)) * dir);
      }
    }

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filters, query, search, sort, sortable, innerFilters]);

  const total = filtered.length;
  const pageCount = paginated ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  // A filter that empties the last page must not strand the user on it.
  // Derived rather than corrected in an effect — storing the clamp would
  // render twice and briefly show an empty page.
  const safePage = Math.min(page, pageCount);

  const rows = paginated
    ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
    : filtered;

  const isFiltered =
    query.trim() !== "" ||
    (filters ?? []).some((f) => filterValue(f) !== (f.allValue ?? "All"));

  function toggleSort(columnId: string) {
    setPage(1);
    setSort((prev) =>
      prev?.columnId !== columnId
        ? { columnId, dir: "asc" }
        : prev.dir === "asc"
          ? { columnId, dir: "desc" }
          : undefined,
    );
  }

  return {
    query,
    setQuery: (v: string) => {
      setPage(1);
      setQuery(v);
    },
    filterValue,
    setFilterValue: (f: TypedFilterDef<T>, v: string) => {
      setPage(1);
      setFilterValue(f, v);
    },
    sort,
    toggleSort,
    page: safePage,
    setPage,
    pageSize,
    setPageSize: (n: number) => {
      setPage(1);
      setPageSize(n);
    },
    pageCount,
    total,
    rows,
    isFiltered,
    clear: () => {
      setPage(1);
      setQuery("");
      setInnerFilters({});
      for (const f of filters ?? []) f.onChange?.(f.allValue ?? "All");
    },
  };
}
