import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";
import { TICKET_STATUSES, type TicketStatus } from "@/types";

const isStatus = (v: string | null): v is TicketStatus =>
  Boolean(v) && (TICKET_STATUSES as readonly string[]).includes(v as string);

const ALL = "All";
/** Triage order — the same key the list endpoint falls back to. */
const DEFAULT_SORT_BY = "slaState";
const DEFAULT_SORT_DIR = "asc";

/**
 * Narrowing that arrives from the dashboard rather than from this screen's own
 * controls: a territory, and a range of intake dates.
 *
 * The board has no UI for them — they exist so an attention card can open a
 * list holding exactly what it counted. They pass straight through to the API,
 * which applies the same `narrowed()` the dashboard's own figures use, and they
 * survive every other filter change because `setParams` only writes the keys it
 * owns.
 */
const PASSTHROUGH = ["regionId", "stateId", "dateFrom", "dateTo"] as const;

/** One query-string key, its serialised value, and whether it is the default. */
interface Field {
  key: string;
  value: string;
  isDefault: boolean;
}

/**
 * The whole request as query-string fields. Defaults are recorded rather than
 * written, so a pristine list stays at a bare `/tickets`.
 */
function fields(p: ListParams): Field[] {
  const search = p.search ?? "";
  const status = p.filters?.status ?? ALL;
  const page = p.page ?? 1;
  const limit = p.limit ?? DEFAULT_PAGE_SIZE;
  const sortBy = p.sortBy ?? DEFAULT_SORT_BY;
  const sortDir = p.sortDir ?? DEFAULT_SORT_DIR;
  return [
    { key: "q", value: search, isDefault: search.trim() === "" },
    { key: "status", value: status, isDefault: status === ALL },
    { key: "page", value: String(page), isDefault: page === 1 },
    {
      key: "limit",
      value: String(limit),
      isDefault: limit === DEFAULT_PAGE_SIZE,
    },
    { key: "sortBy", value: sortBy, isDefault: sortBy === DEFAULT_SORT_BY },
    { key: "sortDir", value: sortDir, isDefault: sortDir === DEFAULT_SORT_DIR },
  ];
}

/**
 * The ticket list's request, held in the query string.
 *
 * Not just the filters: page, rows-per-page and sort live here too, so the
 * exact view someone is looking at — page 3 of the escalated tickets, sorted
 * by SLA — can be pasted into a chat, bookmarked, and survives back.
 */
export function useTicketFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("q") ?? "";
  const statusParam = searchParams.get("status");
  const status: TicketStatus | "All" = isStatus(statusParam)
    ? statusParam
    : ALL;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.max(
    1,
    Number(searchParams.get("limit")) || DEFAULT_PAGE_SIZE
  );
  const sortBy = searchParams.get("sortBy") || DEFAULT_SORT_BY;
  const sortDir = searchParams.get("sortDir") === "desc" ? "desc" : "asc";

  // Serialised, so the memo below depends on a value rather than on a fresh
  // object identity every render.
  const inherited = PASSTHROUGH.map((k) => searchParams.get(k) ?? "").join("|");

  // Stable identity keeps the query key from thrashing on every render.
  const params = useMemo<ListParams>(
    // "All" is a control value, not a status — omitted so it never reaches the
    // API as a filter, and so an unfiltered list has one cache key rather than
    // two. The API tolerates it anyway; this keeps the request honest.
    () => {
      const extra = Object.fromEntries(
        PASSTHROUGH.map((k, i) => [k, inherited.split("|")[i]]).filter(
          ([, v]) => v
        )
      );
      const filters = {
        ...(status === ALL ? {} : { status }),
        ...extra,
      };
      return {
        page,
        limit,
        search,
        sortBy,
        sortDir,
        ...(Object.keys(filters).length ? { filters } : {}),
      };
    },
    [page, limit, search, sortBy, sortDir, status, inherited]
  );

  // Chains writes that land in the same tick. `searchParams` is the URL of the
  // current RENDER, not of the write before it — and its functional form reads
  // the same value — so two writes in one event would build on the same base.
  const pending = useRef<URLSearchParams | null>(null);

  /**
   * Takes the full next request, writes only what actually changed.
   *
   * Callers hand back a copy of `params` with a field or two replaced, and
   * "Clear filters" fires two of them in the same tick — one resetting the
   * search box, one the status pill, each still carrying the other's stale
   * value. Diffing means each write touches only its own key.
   */
  const setParams = useCallback(
    (next: ListParams) => {
      const before = fields(params);
      const url = pending.current ?? new URLSearchParams(searchParams);

      fields(next).forEach((f, i) => {
        if (f.value === before[i].value) return;
        if (f.isDefault) url.delete(f.key);
        else url.set(f.key, f.value);
      });

      pending.current = url;
      queueMicrotask(() => {
        pending.current = null;
      });
      // Typing in the search box must not push a history entry per keystroke.
      setSearchParams(url, { replace: true });
    },
    [params, searchParams, setSearchParams]
  );

  return { params, setParams };
}
