import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  type NotificationQuery,
  type OpsNotification,
  type UnreadCount,
} from "@/services/notifications";
import type { Page } from "@/types/api";

/** What the reader has narrowed the feed to — the part that keys the cache. */
export type NotificationFilters = Pick<
  NotificationQuery,
  "search" | "kind" | "unread"
>;

export const notificationKeys = {
  all: ["notifications"] as const,
  /** Every feed, however filtered — the prefix the cache writers match on. */
  feeds: () => ["notifications", "feed"] as const,
  feed: (filters: NotificationFilters) =>
    ["notifications", "feed", filters] as const,
  unread: () => ["notifications", "unread"] as const,
  /**
   * The newest few, for deciding what to announce.
   *
   * Its own key rather than `feed({})`: the feed's key carries whatever the
   * reader has filtered and paged to, so an announcement reading through it
   * would show what the Notifications page happens to be looking at — and
   * would overwrite that page's cache from a background read.
   */
  latest: () => ["notifications", "latest"] as const,
};

/**
 * Twenty rows a page.
 *
 * Enough that the first screenful is usually the whole of today, small enough
 * that the second page arrives before anybody reaches the bottom of the first.
 */
export const NOTIFICATION_PAGE_SIZE = 20;

type Feed = InfiniteData<Page<OpsNotification>>;

/**
 * The feed behind the bell, a page at a time.
 *
 * Escalations and AI flags age in minutes, so this refetches eagerly. The
 * socket is what makes it live — `useTicketStream` invalidates it on
 * `notification.raised` — and `staleTime` is the floor under that: a console
 * whose socket is down still catches up on the next focus rather than sitting
 * on a stale feed until somebody navigates.
 */
export function useNotificationFeed(filters: NotificationFilters) {
  const query = useInfiniteQuery({
    queryKey: notificationKeys.feed(filters),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listNotifications({
        ...filters,
        page: pageParam,
        limit: NOTIFICATION_PAGE_SIZE,
      }),
    getNextPageParam: (last) =>
      last.pagination.hasNextPage ? last.pagination.page + 1 : undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    meta: { errorTitle: "Couldn't load notifications" },
  });

  return {
    ...query,
    /** Every page flattened — what the list renders. */
    rows: query.data?.pages.flatMap((p) => p.rows) ?? [],
    /** How many match the current filters, not how many are loaded. */
    total: query.data?.pages[0]?.pagination.totalRecords ?? 0,
  };
}

/** The bell needs one number, not the feed — and asks the server for exactly that. */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: unreadNotificationCount,
    select: (count: UnreadCount) => count.unread,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Flip `read` on matching rows in every cached feed. Returns the undo.
 *
 * Written into the cache rather than invalidated, for two reasons that both
 * show on screen. An infinite query re-reads EVERY page it holds, so a reader
 * eight pages down would fire eight requests to record one tap. And the feed is
 * ordered by time, not by read state, so the row stays exactly where it is —
 * nothing moves out from under the cursor that just clicked it.
 */
function flipRead(
  queryClient: QueryClient,
  matches: (n: OpsNotification) => boolean
): () => void {
  const before = queryClient.getQueriesData<Feed>({
    queryKey: notificationKeys.feeds(),
  });

  for (const [key, feed] of before) {
    if (!feed) continue;
    queryClient.setQueryData<Feed>(key, {
      ...feed,
      pages: feed.pages.map((page) => ({
        ...page,
        rows: page.rows.map((n) =>
          !n.read && matches(n) ? { ...n, read: true } : n
        ),
      })),
    });
  }

  return () => {
    for (const [key, feed] of before) queryClient.setQueryData(key, feed);
  };
}

/**
 * Reading one, either by opening it or by dismissing it.
 *
 * Optimistic, because the usual way this fires is a click that is ALSO a
 * navigation: the row has to look read before the screen it links to has
 * finished mounting, or it never looked read at all.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't update the notification" },
    mutationFn: markNotificationRead,
    onMutate: async (id: string) => {
      // An in-flight read would land after this write and undo it.
      await queryClient.cancelQueries({ queryKey: notificationKeys.feeds() });
      return { undo: flipRead(queryClient, (n) => n.id === id) };
    },
    onError: (_error, _id, context) => context?.undo(),
    // The server answers with the count AFTER the write, so the bell is told
    // rather than asked — one round trip, and no window where the badge and
    // the list disagree.
    onSuccess: (count) =>
      queryClient.setQueryData(notificationKeys.unread(), count),
  });
}

/**
 * Everything visible and unread — not just what the current filter shows.
 *
 * That is the server's rule, and it is the right one: this is the button that
 * empties the bell, so a bell still carrying a count afterwards would be the
 * thing people report. The cache write below matches it.
 */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't update the notifications" },
    mutationFn: () => markAllNotificationsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.feeds() });
      return { undo: flipRead(queryClient, () => true) };
    },
    onError: (_error, _vars, context) => context?.undo(),
    onSuccess: (count) =>
      queryClient.setQueryData(notificationKeys.unread(), count),
  });
}
