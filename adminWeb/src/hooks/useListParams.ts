import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";

/**
 * The query string of a server-paged list.
 *
 * A page owns one `ListParams` object and hands it to its hook and its table.
 * The table reports intent — a search term, a filter, a page — and never
 * slices anything itself: the backend paginates, so doing it again in the
 * browser would page an already-paged page.
 */

/** The value a filter carries when it is not narrowing anything. */
export const ALL_FILTER = "All";

export function useListParams(initial: ListParams = {}) {
  return useState<ListParams>({
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
    ...initial,
  });
}

/**
 * Sets or clears the search term.
 *
 * Always back to page 1 — page 4 of a narrower result set may not exist, and
 * landing on an empty page reads as "no results" when there are plenty.
 */
export function withSearch(params: ListParams, value: string): ListParams {
  const search = value.trim();
  const next: ListParams = { ...params, page: 1 };
  if (search) next.search = search;
  else delete next.search;
  return next;
}

/**
 * Sets or clears one domain filter. "All" is a control value, not a filter —
 * it is removed from the query string rather than sent to the server.
 */
export function withFilter(
  params: ListParams,
  id: string,
  value: string
): ListParams {
  const filters = { ...params.filters };
  if (!value || value === ALL_FILTER) delete filters[id];
  else filters[id] = value;

  const next: ListParams = { ...params, page: 1, filters };
  if (Object.keys(filters).length === 0) delete next.filters;
  return next;
}

/** Reads one filter back for a controlled toolbar control. */
export function filterValue(params: ListParams, id: string): string {
  return params.filters?.[id] ?? ALL_FILTER;
}

/**
 * Composes several param writes made inside a single event.
 *
 * `DataTableProps.server.onParams` takes a value, not an updater — so the
 * three calls "Clear filters" makes in one event would each be derived from
 * the same render's `params` and only the last would survive. Threading them
 * through a ref keeps them additive.
 */
export function useParamsWriter(
  params: ListParams,
  onParams: (next: ListParams) => void
) {
  const latest = useRef(params);

  // Re-synced after the commit, so params changed from outside (a reset, a
  // route change) win over whatever this writer last produced.
  useEffect(() => {
    latest.current = params;
  }, [params]);

  return useCallback(
    (apply: (current: ListParams) => ListParams) => {
      latest.current = apply(latest.current);
      onParams(latest.current);
    },
    [onParams]
  );
}
