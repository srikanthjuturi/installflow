import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
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
 * `useListParams`, seeded from `?search=` in the URL.
 *
 * For the screens global search lands on. Users, vendors and the product master
 * have no detail route, so a hit there navigates to the list with the term
 * already applied — which only works if the list reads it.
 *
 * Seeded rather than bound: the box is the user's the moment they touch it, so
 * clearing it does not fight the URL it arrived from. The term is re-applied
 * only when the URL's own value CHANGES, which is what makes a second search
 * for something else work while the page is already open — a plain initial
 * value would be ignored, because React Router reuses the component.
 */
export function useUrlSeededListParams(
  initial: ListParams = {},
  /**
   * Query keys to seed as FILTERS rather than as the search term — e.g.
   * `["districtId"]`, so `/technicians?districtId=…` arrives filtered. Named
   * explicitly rather than sweeping up every unknown key: `page` and `limit`
   * are also in that query string and are not filters.
   */
  filterKeys: readonly string[] = []
) {
  const [searchParams] = useSearchParams();
  const fromUrl = searchParams.get("search")?.trim() || undefined;

  // A stable signature of the seeded filters, so the same comparison that
  // re-applies a changed search term works for them too without comparing
  // objects by identity on every render.
  const seededFilters: Record<string, string> = {};
  for (const key of filterKeys) {
    const value = searchParams.get(key)?.trim();
    if (value) seededFilters[key] = value;
  }
  const filterSignature = JSON.stringify(seededFilters);

  const [params, setParams] = useState<ListParams>({
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
    ...initial,
    ...(fromUrl ? { search: fromUrl } : {}),
    ...(filterSignature !== "{}" ? { filters: { ...seededFilters } } : {}),
  });

  // Adjusted during render, not in an effect: the list must not fetch once
  // unfiltered and then again with the term, which is a visible flash of the
  // wrong rows and one wasted request.
  const [seeded, setSeeded] = useState(fromUrl);
  if (seeded !== fromUrl) {
    setSeeded(fromUrl);
    setParams((current) => withSearch(current, fromUrl ?? ""));
  }

  // The same rule for the filters, and for the same reason: arriving a second
  // time from a different district must re-apply, or the list would answer the
  // question the previous link asked.
  const [seededSignature, setSeededSignature] = useState(filterSignature);
  if (seededSignature !== filterSignature) {
    setSeededSignature(filterSignature);
    setParams((current) => {
      let next = current;
      for (const key of filterKeys) {
        next = withFilter(next, key, seededFilters[key] ?? "");
      }
      return next;
    });
  }

  return [params, setParams] as const;
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
