import type { ListParams, PaginationMeta } from "@/types/api";
import type { LucideIcon } from "lucide-react";

/** A sortable value. `null` sorts last regardless of direction. */
export type SortValue = string | number | null;

export interface Column<T> {
  /** Stable id — used for sort state and as the React key. */
  id: string;
  /** Visible header text. Keep it the approved string. */
  header: string;
  /** Renders the cell. */
  cell: (row: T) => React.ReactNode;
  /**
   * Makes the column sortable. Return the value to compare, NOT the rendered
   * node — a cell may render a badge while sorting on an underlying rank.
   */
  sortValue?: (row: T) => SortValue;
  /** Right-align numeric columns so digits line up. */
  align?: "left" | "right";
  /** Extra classes on the body cell. */
  cellClassName?: string;
  /** Hide the header text visually but keep it for assistive tech. */
  hideHeader?: boolean;
  /** Keep this column visible when the table scrolls horizontally. */
  sticky?: boolean;
}

export interface FilterOption {
  value: string;
  label: string;
  /** A dimmer second line under the label. `combobox` only. */
  hint?: string;
}

export interface FilterDef {
  id: string;
  label: string;
  options: FilterOption[];
  /** Controlled value. Omit to let the table own it. */
  value?: string;
  onChange?: (value: string) => void;
  /** Value meaning "no filter". Defaults to "All". */
  allValue?: string;
  /**
   * Label for the clear-the-filter option. Pills get one prepended
   * automatically unless `options` already contains `allValue` — without it a
   * pill filter can be set but never cleared.
   */
  allLabel?: string;
  /** `pills` for a small set, `select` for a long one. */
  /**
   * `pills` for a handful of choices, `select` for a menu, `combobox` for a
   * list too long to scroll — it types to search and pages as it scrolls.
   * Defaults to pills at 7 options or fewer, select above that.
   */
  variant?: "pills" | "select" | "combobox";
  /**
   * `combobox` only. Called as the user types; the caller narrows `options`.
   * Whether that narrowing happens in memory or over the network is the
   * caller's business — see `useIncrementalOptions`.
   */
  onSearch?: (query: string) => void;
  /** `combobox` only. Reveal the next page; called on scrolling near the end. */
  onLoadMore?: () => void;
  /** `combobox` only. Without it `onLoadMore` is never called. */
  hasMore?: boolean;
  /** `combobox` only. True while a search is in flight. */
  loading?: boolean;
  /** `combobox` only. True while the next page is in flight. */
  loadingMore?: boolean;
  /** Matches a row against the active value. Omit in server mode — the
   *  backend filters, so a client matcher would be dead code. */
  match?: (row: never, value: string) => boolean;
}

export interface TypedFilterDef<T> extends Omit<FilterDef, "match"> {
  match?: (row: T, value: string) => boolean;
}

export interface SortState {
  columnId: string;
  dir: "asc" | "desc";
}

export interface DataTableProps<T> {
  /** Rows. `undefined` while loading. */
  data?: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;

  /** Screen-reader caption. Required: a data table without one is unnavigable. */
  caption: string;

  isLoading?: boolean;
  /**
   * A refetch is in flight while previous rows are still shown. With
   * keepPreviousData the table never blanks, so without this signal a slow
   * page change looks like nothing happened.
   */
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Names what failed to load. Falls back to the generic error copy. */
  errorTitle?: string;

  /**
   * Renders without the card rail, for a table that already sits inside a
   * Card. Without this, the two rounded surfaces nest and read as a bug.
   */
  bare?: boolean;

  /** Loading placeholder rows. Defaults to the page size, capped at 8. */
  skeletonRows?: number;

  /** Omit to hide the search box. */
  search?: {
    placeholder: string;
    /** Fields to match against. Ignored when `fn` is given. */
    keys?: Array<keyof T>;
    fn?: (row: T, query: string) => boolean;
    /** Controlled — omit both to let the table own the query. */
    value?: string;
    onChange?: (value: string) => void;
  };

  filters?: Array<TypedFilterDef<T>>;

  /** Rendered at the right of the toolbar — "New ticket", "Export CSV". */
  toolbarActions?: React.ReactNode;

  /** `false` disables paging entirely (short, fixed lists). */
  pagination?: false | { sizes?: number[]; defaultSize?: number };

  /**
   * Server-driven mode.
   *
   * When present the table renders exactly the rows it is given and reports
   * intent upward instead of filtering, sorting or slicing locally — the
   * backend paginates, so doing it again in the browser would page a page.
   * `meta` is the envelope's `pagination` block.
   */
  server?: {
    meta?: PaginationMeta;
    params: ListParams;
    onParams: (next: ListParams) => void;
  };

  defaultSort?: SortState;
  /** Shown beside the row count, e.g. "Sorted by SLA urgency". */
  summary?: React.ReactNode;
  /** Overrides the "N results" phrasing, e.g. "Showing 14 tickets". */
  countLabel?: (count: number) => React.ReactNode;

  /** Makes rows clickable. Pair with a real link inside a cell for keyboard. */
  onRowClick?: (row: T) => void;
  /** Extra classes per row — e.g. tinting a rejected import row. */
  rowClassName?: (row: T) => string | undefined;

  /** Minimum table width before the container scrolls horizontally. */
  minWidth?: string;

  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Shown when filters/search hide everything. Falls back to the empty copy. */
  filteredEmptyTitle?: string;
  filteredEmptyDescription?: string;
}
