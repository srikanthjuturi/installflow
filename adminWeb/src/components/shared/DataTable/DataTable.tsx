import { useId } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/shared/states";
import {
  HeadTr,
  Table,
  TableBody,
  TableHeader,
  Td,
  Th,
  Tr,
} from "./primitives";
import { Pagination } from "./Pagination";
import { Toolbar } from "./Toolbar";
import { useDataTable } from "./useDataTable";
import type { DataTableProps } from "./types";

const DEFAULT_SIZES = [10, 20, 50, 100];
const DEFAULT_SIZE = 20;

/**
 * The app's one data table.
 *
 * Every list screen shares this so search, sorting, paging, the three states
 * and the approved chrome behave identically everywhere — and so a fix lands
 * in ten places at once. Columns are declarative; the caller supplies the
 * cells and, where a column is sortable, the value to sort on.
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  caption,
  isLoading,
  isFetching,
  error,
  onRetry,
  errorTitle,
  bare,
  skeletonRows,
  search,
  filters,
  toolbarActions,
  pagination = {},
  defaultSort,
  summary,
  countLabel,
  server,
  onRowClick,
  rowClassName,
  minWidth,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  filteredEmptyTitle,
  filteredEmptyDescription,
}: DataTableProps<T>) {
  const tableId = useId();
  const paginated = pagination !== false;
  const sizes = (paginated && pagination.sizes) || DEFAULT_SIZES;
  const defaultSize = (paginated && pagination.defaultSize) || DEFAULT_SIZE;

  // In server mode the backend has already filtered, sorted and sliced —
  // running the client pipeline again would page an already-paged page.
  const isServer = Boolean(server);

  const t = useDataTable<T>({
    data,
    columns,
    filters,
    search,
    defaultSort,
    pageSizeDefault: defaultSize,
    paginated: paginated && !isServer,
    passthrough: isServer,
  });

  const meta = server?.meta;
  const page = isServer ? (meta?.page ?? 1) : t.page;
  const pageCount = isServer ? (meta?.totalPages ?? 1) : t.pageCount;
  const pageSize = isServer ? (meta?.limit ?? defaultSize) : t.pageSize;
  const total = isServer ? (meta?.totalRecords ?? 0) : t.total;

  const setPage = (p: number) =>
    isServer ? server!.onParams({ ...server!.params, page: p }) : t.setPage(p);

  // A larger page must start from the top: page 4 of 10-per-page does not
  // exist once the size becomes 100.
  const setPageSize = (n: number) =>
    isServer
      ? server!.onParams({ ...server!.params, limit: n, page: 1 })
      : t.setPageSize(n);

  // In server mode the sort has to travel to the query, not stay in local
  // state — otherwise the header arrow flips and the rows never move.
  const activeSort = isServer
    ? server!.params.sortBy
      ? {
          columnId: server!.params.sortBy,
          dir: server!.params.sortDir ?? "asc",
        }
      : defaultSort
    : t.sort;

  const toggleSort = (columnId: string) => {
    if (!isServer) return t.toggleSort(columnId);
    const same = activeSort?.columnId === columnId;
    server!.onParams({
      ...server!.params,
      page: 1,
      sortBy: columnId,
      sortDir: same && activeSort?.dir === "asc" ? "desc" : "asc",
    });
  };

  const toolbar = (
    <Toolbar
      search={search}
      query={t.query}
      onQuery={t.setQuery}
      filters={filters ?? []}
      filterValue={t.filterValue}
      onFilter={t.setFilterValue}
      actions={toolbarActions}
      tableId={tableId}
      pageSize={
        paginated
          ? { value: pageSize, sizes, onChange: setPageSize }
          : undefined
      }
    />
  );

  if (error) {
    return (
      <>
        {toolbar}
        <ErrorState title={errorTitle} error={error} onRetry={onRetry} />
      </>
    );
  }

  const showEmpty = !isLoading && total === 0;
  // Two skeleton rows are enough to signal "a table is loading" without
  // painting a full page of placeholders. Callers can override via `skeletonRows`.
  const placeholderRows = skeletonRows ?? 2;
  // `bare` drops the rail for a table already inside a Card — two nested
  // rounded surfaces read as a bug, not as depth.
  const panel = bare
    ? undefined
    : "bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10";

  return (
    <>
      {toolbar}

      <div className={panel}>
        {summary || paginated ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3 text-xs text-ink-2">
            <span aria-live="polite">
              {isLoading ? (
                "Loading…"
              ) : countLabel ? (
                countLabel(total)
              ) : (
                <>
                  <b className="text-ink">{total}</b>{" "}
                  {total === 1 ? "result" : "results"}
                </>
              )}
            </span>
            {summary ? <span>{summary}</span> : null}
          </div>
        ) : null}

        {showEmpty ? (
          <div className="p-2">
            {t.isFiltered ? (
              <EmptyState
                title={filteredEmptyTitle ?? "Nothing matches those filters"}
                description={
                  filteredEmptyDescription ??
                  "Try a different filter, or clear the search."
                }
                action={
                  <button
                    type="button"
                    onClick={t.clear}
                    className="text-sm font-semibold text-brand-400 hover:text-brand-500"
                  >
                    Clear filters
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={emptyIcon}
                title={emptyTitle}
                description={emptyDescription}
                action={emptyAction}
              />
            )}
          </div>
        ) : (
          <div
            className={cn(
              "scroll-x transition-opacity",
              // Stale rows stay readable but visibly not-current.
              isFetching && !isLoading && "opacity-60"
            )}
            aria-busy={isFetching && !isLoading ? true : undefined}
          >
            <Table id={tableId} style={minWidth ? { minWidth } : undefined}>
              <caption className="sr-only">{caption}</caption>
              <TableHeader>
                <HeadTr>
                  {columns.map((c) => {
                    const active = activeSort?.columnId === c.id;
                    const SortIcon = !active
                      ? ChevronsUpDown
                      : activeSort?.dir === "asc"
                        ? ArrowUp
                        : ArrowDown;
                    return (
                      <Th
                        key={c.id}
                        // From `activeSort`, not local state: in server mode
                        // the sort lives in the query params and `t.sort` is
                        // undefined, so reading it here crashed the table the
                        // moment a server-sorted column matched a column id.
                        aria-sort={
                          active
                            ? activeSort!.dir === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                        className={cn(
                          c.align === "right" && "text-right",
                          c.sticky && "sticky left-0 z-10 bg-surface-2"
                        )}
                      >
                        {c.sortValue ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.id)}
                            aria-controls={tableId}
                            className={cn(
                              "inline-flex items-center gap-1 uppercase transition-colors hover:text-ink",
                              c.align === "right" && "flex-row-reverse",
                              active && "text-ink"
                            )}
                          >
                            <span className={cn(c.hideHeader && "sr-only")}>
                              {c.header}
                            </span>
                            <SortIcon className="size-3" aria-hidden />
                          </button>
                        ) : (
                          <span className={cn(c.hideHeader && "sr-only")}>
                            {c.header}
                          </span>
                        )}
                      </Th>
                    );
                  })}
                </HeadTr>
              </TableHeader>

              <TableBody>
                {isLoading
                  ? Array.from({ length: placeholderRows }).map((_, r) => (
                      <Tr key={r} className="hover:bg-transparent">
                        {columns.map((c, i) => (
                          <Td key={c.id}>
                            <Skeleton
                              className="h-4"
                              style={{ width: i === 0 ? "70%" : "55%" }}
                            />
                          </Td>
                        ))}
                      </Tr>
                    ))
                  : t.rows.map((row) => (
                      <Tr
                        key={getRowId(row)}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        className={cn(
                          onRowClick && "cursor-pointer",
                          rowClassName?.(row)
                        )}
                      >
                        {columns.map((c) => (
                          <Td
                            key={c.id}
                            className={cn(
                              c.align === "right" && "text-right",
                              c.sticky && "sticky left-0 bg-card",
                              c.cellClassName
                            )}
                          >
                            {c.cell(row)}
                          </Td>
                        ))}
                      </Tr>
                    ))}
              </TableBody>
            </Table>
          </div>
        )}

        {paginated && !showEmpty ? (
          <Pagination
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
            tableId={tableId}
          />
        ) : null}
      </div>
    </>
  );
}
