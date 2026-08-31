import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { searchByType, searchPreview } from "@/services/search";
import { MIN_SEARCH_TERM, type SearchType } from "@/types/search";

/**
 * Query keys for the topbar search.
 *
 * Both are prefixed `["search"]` so a company switch drops them with everything
 * else — `useSwitchCompany` clears the whole cache, and results are per-company
 * like every other read.
 */
export const searchKeys = {
  all: ["search"] as const,
  preview: (term: string) => ["search", "preview", term] as const,
  type: (type: SearchType, term: string) =>
    ["search", "type", type, term] as const,
};

/** Long enough to be worth asking about. */
export function isSearchable(term: string): boolean {
  return term.trim().length >= MIN_SEARCH_TERM;
}

/**
 * The preview — the top few of every type.
 *
 * `keepPreviousData` matters more here than on a list screen: the term changes
 * on a keystroke, and without it the panel would blink through empty on every
 * pause instead of settling from one set of results to the next.
 */
export function useGlobalSearch(term: string) {
  return useQuery({
    queryKey: searchKeys.preview(term.trim()),
    queryFn: () => searchPreview(term.trim()),
    enabled: isSearchable(term),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    meta: { errorTitle: "Couldn't run the search" },
  });
}

/** How many rows a drill-down asks for at a time. */
const PAGE = 20;

/**
 * One type, paged — the panel's infinite scroll.
 *
 * `type` is null while the panel is showing the preview, which disables the
 * query rather than unmounting the hook.
 */
export function useGlobalSearchType(term: string, type: SearchType | null) {
  const query = useInfiniteQuery({
    queryKey: searchKeys.type(type ?? "ticket", term.trim()),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      searchByType(type!, term.trim(), { page: pageParam, limit: PAGE }),
    getNextPageParam: (last) =>
      last.pagination.hasNextPage ? last.pagination.page + 1 : undefined,
    enabled: !!type && isSearchable(term),
    staleTime: 30_000,
    meta: { errorTitle: "Couldn't run the search" },
  });

  return {
    ...query,
    rows: query.data?.pages.flatMap((p) => p.rows) ?? [],
    total: query.data?.pages[0]?.pagination.totalRecords ?? 0,
  };
}
