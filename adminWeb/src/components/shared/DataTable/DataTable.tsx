import { useId } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { HeadTr, Table, TableBody, TableHeader, Td, Th, Tr } from "./primitives";
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
  error,
  onRetry,
  search,
  filters,
  toolbarActions,
  pagination = {},
  defaultSort,
  summary,
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

  const t = useDataTable<T>({
    data,
    columns,
    filters,
    search,
    defaultSort,
    pageSizeDefault: defaultSize,
    paginated,
  });

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
    />
  );

  if (error) {
    return (
      <>
        {toolbar}
        <ErrorState error={error} onRetry={onRetry} />
      </>
    );
  }

  const showEmpty = !isLoading && t.total === 0;

  return (
    <>
      {toolbar}

      <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {summary || paginated ? (
          <div className="border-line-2 text-ink-2 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-xs">
            <span aria-live="polite">
              {isLoading ? (
                "Loading…"
              ) : (
                <>
                  <b className="text-ink">{t.total}</b>{" "}
                  {t.total === 1 ? "result" : "results"}
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
                  filteredEmptyDescription ?? "Try a different filter, or clear the search."
                }
                action={
                  <button
                    type="button"
                    onClick={t.clear}
                    className="text-brand-400 hover:text-brand-500 text-sm font-semibold"
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
          <div className="scroll-x">
            <Table id={tableId} style={minWidth ? { minWidth } : undefined}>
              <caption className="sr-only">{caption}</caption>
              <TableHeader>
                <HeadTr>
                  {columns.map((c) => {
                    const active = t.sort?.columnId === c.id;
                    const SortIcon = !active
                      ? ChevronsUpDown
                      : t.sort?.dir === "asc"
                        ? ArrowUp
                        : ArrowDown;
                    return (
                      <Th
                        key={c.id}
                        aria-sort={
                          active ? (t.sort!.dir === "asc" ? "ascending" : "descending") : undefined
                        }
                        className={cn(
                          c.align === "right" && "text-right",
                          c.sticky && "bg-surface-2 sticky left-0 z-10",
                        )}
                      >
                        {c.sortValue ? (
                          <button
                            type="button"
                            onClick={() => t.toggleSort(c.id)}
                            aria-controls={tableId}
                            className={cn(
                              "hover:text-ink inline-flex items-center gap-1 uppercase transition-colors",
                              c.align === "right" && "flex-row-reverse",
                              active && "text-ink",
                            )}
                          >
                            <span className={cn(c.hideHeader && "sr-only")}>{c.header}</span>
                            <SortIcon className="size-3" aria-hidden />
                          </button>
                        ) : (
                          <span className={cn(c.hideHeader && "sr-only")}>{c.header}</span>
                        )}
                      </Th>
                    );
                  })}
                </HeadTr>
              </TableHeader>

              <TableBody>
                {isLoading
                  ? Array.from({ length: Math.min(defaultSize, 8) }).map((_, r) => (
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
                          rowClassName?.(row),
                        )}
                      >
                        {columns.map((c) => (
                          <Td
                            key={c.id}
                            className={cn(
                              c.align === "right" && "text-right",
                              c.sticky && "bg-card sticky left-0",
                              c.cellClassName,
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
            page={t.page}
            pageCount={t.pageCount}
            pageSize={t.pageSize}
            sizes={sizes}
            total={t.total}
            onPage={t.setPage}
            onPageSize={t.setPageSize}
            tableId={tableId}
          />
        ) : null}
      </div>
    </>
  );
}
