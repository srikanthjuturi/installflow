import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSession } from "@/store/session";
import type { SearchType } from "@/types/search";

/**
 * The records this person opened, most recent first.
 *
 * Client state, not server state, so it belongs here rather than in TanStack
 * Query (hard rule 4): it is a trail of what somebody looked at, not a copy of
 * anything the API owns. Persisted for the same reason the collapsed sidebar is
 * — a list that emptied on every reload would not be worth having.
 *
 * **A stored entry is a bookmark, not a row.** It keeps only what is needed to
 * draw a line and follow it, and deliberately NOT the status chip a search hit
 * carries: a ticket's status is exactly the thing that changes while you are
 * not looking at it, and rendering yesterday's from a cache would be showing a
 * number with a real source as if it were current.
 */
export interface RecentItem {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  /** Epoch ms. Ordering only; never rendered. */
  seenAt: number;
}

/** How many to remember. Enough to cover a morning's work, short enough to scan. */
const LIMIT = 6;

/** One stable identity for "nothing here", so `items` never churns. */
const EMPTY: RecentItem[] = [];

interface RecentlySeenState {
  /**
   * Keyed by `userId:companyId`.
   *
   * Both halves are load-bearing. **Company**, because rule 0 says one
   * company's data never appears under another and a switch must not leave the
   * previous tenant's ticket numbers sitting in a panel. **User**, because
   * `localStorage` belongs to the browser, not the account, so without it the
   * next person to sign in on a shared desk would inherit the last one's trail.
   */
  byScope: Record<string, RecentItem[]>;
  record: (scope: string, item: Omit<RecentItem, "seenAt">) => void;
  clear: (scope: string) => void;
}

const useRecentlySeenStore = create<RecentlySeenState>()(
  persist(
    (set) => ({
      byScope: {},

      record: (scope, item) =>
        set((state) => {
          const existing = state.byScope[scope] ?? [];
          // Re-opening something moves it to the front rather than adding a
          // second line for it, and the fresh title wins — a renamed model
          // should not read under its old name because it was seen once before.
          const next = [
            { ...item, seenAt: Date.now() },
            ...existing.filter(
              (e) => !(e.type === item.type && e.id === item.id)
            ),
          ].slice(0, LIMIT);
          return { byScope: { ...state.byScope, [scope]: next } };
        }),

      // Only this scope. Another company's trail, or another account's on the
      // same browser, is not this button's to throw away.
      clear: (scope) =>
        set((state) => {
          const rest = { ...state.byScope };
          delete rest[scope];
          return { byScope: rest };
        }),
    }),
    { name: "rgt-recently-seen", version: 1 }
  )
);

/**
 * The current scope's trail, plus the two ways to change it.
 *
 * `record` is a no-op when there is no signed-in company — which is what a
 * superadmin on `/companies` has, and they have no ops records to remember.
 */
export function useRecentlySeen() {
  const userId = useSession((s) => s.backendUser?.id);
  const companyId = useSession((s) => s.activeCompanyId);
  // The portal shares `TicketDetailPage` with the ops console but has no global
  // search to show a trail in, so recording there would only ever write storage
  // nothing reads. A vendor is refused by the search API too.
  const portal = useSession((s) => s.portal);
  const byScope = useRecentlySeenStore((s) => s.byScope);
  const recordIn = useRecentlySeenStore((s) => s.record);
  const clearIn = useRecentlySeenStore((s) => s.clear);

  const scope =
    userId && companyId && !portal ? `${userId}:${companyId}` : null;

  // Stable, so a caller can put `record` in a dependency list — which the
  // detail screens have to, since they record from an effect.
  const record = useCallback(
    (item: Omit<RecentItem, "seenAt">) => {
      if (scope) recordIn(scope, item);
    },
    [scope, recordIn]
  );

  const clear = useCallback(() => {
    if (scope) clearIn(scope);
  }, [scope, clearIn]);

  const items = useMemo(
    () => (scope ? (byScope[scope] ?? EMPTY) : EMPTY),
    [scope, byScope]
  );

  return { items, record, clear };
}

/**
 * Remember this record as seen, once it is known.
 *
 * Takes the fields rather than an object so the effect can depend on them
 * directly — an object rebuilt every render would re-record on every render.
 * A screen that is still loading passes `undefined` for the id and nothing
 * happens; the entry lands when the data does.
 *
 * Called from the detail screens as well as from global search, because
 * "recently seen" has to mean SEEN. A trail that only remembered what you found
 * through the search box would be circular — it would show you the things you
 * already knew how to find.
 */
export function useRecordRecentlySeen(
  type: SearchType,
  id: string | undefined,
  title: string | undefined,
  subtitle: string | null = null
) {
  const { record } = useRecentlySeen();

  useEffect(() => {
    if (!id || !title) return;
    record({ type, id, title, subtitle });
  }, [record, type, id, title, subtitle]);
}
