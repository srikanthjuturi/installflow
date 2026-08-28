import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "@/services/notifications";
import type { NotificationFilters } from "./useNotifications";

const isKind = (v: string | null): v is NotificationKind =>
  Boolean(v) && (NOTIFICATION_KINDS as readonly string[]).includes(v as string);

/**
 * What the reader has narrowed the feed to, held in the query string.
 *
 * `/notifications?kind=escalation&unread=1` is a view somebody can bookmark or
 * paste to a colleague — "these are the ones nobody has picked up" — and it
 * survives a back navigation out of a ticket and straight into the list they
 * were working through. State kept in a component would lose all of that on
 * the first click.
 *
 * A default is never written. An untouched feed stays at a bare
 * `/notifications`, so the URL only ever names what has actually been changed.
 */
export function useNotificationFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const kindParam = searchParams.get("kind");
  const search = searchParams.get("q") ?? "";
  const kind = isKind(kindParam) ? kindParam : undefined;
  const unread = searchParams.get("unread") === "1";

  // Stable identity — this object keys the query, and a fresh one every render
  // would refetch the feed on every render.
  const filters = useMemo<NotificationFilters>(
    () => ({ search: search || undefined, kind, unread: unread || undefined }),
    [search, kind, unread]
  );

  /**
   * Writes only the keys it is given, so "Clear" can reset all three in one
   * call and a filter change never silently drops the search term.
   *
   * `replace` because typing must not push a history entry per keystroke —
   * Back would then walk the search box backwards one character at a time.
   */
  const patch = useCallback(
    (next: Partial<{ search: string; kind?: NotificationKind; unread: boolean }>) => {
      const url = new URLSearchParams(searchParams);
      if ("search" in next) {
        if (next.search?.trim()) url.set("q", next.search);
        else url.delete("q");
      }
      if ("kind" in next) {
        if (next.kind) url.set("kind", next.kind);
        else url.delete("kind");
      }
      if ("unread" in next) {
        if (next.unread) url.set("unread", "1");
        else url.delete("unread");
      }
      setSearchParams(url, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const clear = useCallback(
    () => patch({ search: "", kind: undefined, unread: false }),
    [patch]
  );

  return {
    filters,
    /** The raw box contents — the request that uses it is debounced, not this. */
    search,
    kind,
    unread,
    isFiltered: Boolean(search.trim() || kind || unread),
    patch,
    clear,
  };
}
