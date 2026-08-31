import { useCallback, useMemo, useState } from "react";

/** How many rows a combobox reveals before it has to be scrolled again. */
const PAGE = 30;

export interface IncrementalOption {
  value: string;
  label: string;
  /** A dimmer second line — the state a district sits in, say. */
  hint?: string;
}

/**
 * Search and infinite scroll over a list that is ALREADY in memory.
 *
 * For a bounded reference list the server has handed over whole — the 754
 * districts of India, cached for an hour because they change only on a
 * re-import. Paging that over the network would add a 170–600 ms round trip
 * per scroll (measured against this database) to answer a question the browser
 * can already answer instantly, and would make search worse in the same way.
 *
 * What it gives the caller is the same shape a server-paged search does —
 * `options`, `hasMore`, `loadMore`, `onSearch` — so a list that genuinely
 * outgrows one response can move to `useInfiniteQuery` without the control
 * above it changing at all.
 *
 * Matching is on the label AND the hint: two districts really are both called
 * Bilaspur, in Himachal Pradesh and in Chhattisgarh, so somebody typing
 * "bilaspur chh" has to be able to get to the right one.
 */
export function useIncrementalOptions(
  all: IncrementalOption[],
  pageSize = PAGE
) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(pageSize);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    // Every word has to appear somewhere, so "bilaspur him" narrows to one of
    // the two rather than matching either.
    const words = q.split(/\s+/);
    return all.filter((option) => {
      const haystack = `${option.label} ${option.hint ?? ""}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [all, query]);

  const onSearch = useCallback(
    (next: string) => {
      setQuery(next);
      // Back to the top of a new result set: keeping a deep window would show
      // page three of matches nobody has seen page one of.
      setShown(pageSize);
    },
    [pageSize]
  );

  const loadMore = useCallback(
    () => setShown((n) => n + pageSize),
    [pageSize]
  );

  return {
    options: useMemo(() => matches.slice(0, shown), [matches, shown]),
    hasMore: shown < matches.length,
    loadMore,
    onSearch,
    /** Everything matching, for a caller that needs the count rather than the page. */
    matchCount: matches.length,
  };
}
