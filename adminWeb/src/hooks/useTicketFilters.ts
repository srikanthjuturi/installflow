import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";
import { TICKET_STATUSES } from "@/types";

/**
 * A status filter, which is a SET — one member or several, comma-separated.
 *
 * The dashboard's funnel counts populations a single status cannot name:
 * "Assigned / in progress" is two, and "Closed" is two more once a
 * force-closure counts as finished. `GET /tickets` takes the same set, so a
 * tile can open a list holding exactly what it counted.
 *
 * Validated member by member, and an unknown one falls back to "All" rather
 * than travelling: the whole point of keeping this in the URL is that it gets
 * pasted and bookmarked, and a stale value must not reach the API as a filter
 * matching nothing.
 */
const isStatusSet = (v: string | null): boolean =>
  Boolean(v) &&
  (v as string)
    .split(",")
    .every((part) =>
      (TICKET_STATUSES as readonly string[]).includes(part.trim())
    );

const ALL = "All";
/** Triage order — the same key the list endpoint falls back to. */
const DEFAULT_SORT_BY = "slaState";
const DEFAULT_SORT_DIR = "asc";

/**
 * Narrowing that arrives from the dashboard rather than from this screen's own
 * controls: a territory, a range of intake dates, and the three narrowings its
 * tiles need to open a list holding exactly what they counted.
 *
 * The board has no UI for any of them. They pass straight through to the API —
 * which applies the same expressions the dashboard's own figures came from —
 * and they survive every other filter change because `setParams` only writes
 * the keys it owns. `NarrowedNotice` on the list says they are on, because a
 * filter you cannot see is one you forget you left running.
 *
 *   slaState          one bucket of `_sla_order_case`, the SLA bar's own rank
 *   open              "not yet closed", the Open tickets tile's own expression
 *   closedWithinDays  the rolling window "Closed this week" was measured over
 */
const PASSTHROUGH = [
  "regionId",
  "stateId",
  "dateFrom",
  "dateTo",
  "slaState",
  "open",
  "closedWithinDays",
] as const;

/**
 * The two passthrough keys a status the reader picks HAS to clear.
 *
 * Both are status-shaped: arriving on "Closed this week" and then clicking the
 * Slot Pending chip would otherwise ask for slot-pending tickets closed in the
 * last seven days and read empty, with the chip on screen insisting otherwise.
 * `slaState` is not in the list — it is a different axis, and "breaching AND
 * assigned" is a refinement somebody may legitimately want.
 */
const STATUS_SHAPED = ["open", "closedWithinDays"] as const;

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
  // A single status, or the dashboard's comma-separated set. `string` rather
  // than `TicketStatus` because a set is not one of them — the members are
  // validated above, and the API canonicalises them again on arrival.
  const status: string = isStatusSet(statusParam)
    ? (statusParam as string)
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
        // The status the reader just picked replaces the one they arrived on,
        // and takes its status-shaped companions with it — see `STATUS_SHAPED`.
        if (f.key === "status") for (const k of STATUS_SHAPED) url.delete(k);
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

  /**
   * Drop everything the dashboard sent that this screen has no control for.
   *
   * Lives here rather than in the page because this hook owns the query-string
   * contract; a second list of key names in a component is the list that drifts
   * when one is added.
   *
   * A MULTI status goes with them and a single one stays. The chips can show
   * one status and cannot show a set, so a set is exactly as invisible as the
   * rest of this — while a lone "Slot Pending" is on screen, selected, and
   * clearing it would undo something the reader can see themselves.
   */
  const clearNarrowing = useCallback(() => {
    const url = new URLSearchParams(searchParams);
    for (const key of PASSTHROUGH) url.delete(key);
    if ((url.get("status") ?? "").includes(",")) url.delete("status");
    // Page 4 of the narrowed list is not page 4 of the whole board.
    url.delete("page");
    setSearchParams(url, { replace: true });
  }, [searchParams, setSearchParams]);

  return { params, setParams, clearNarrowing };
}
