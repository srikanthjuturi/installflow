import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "@/services/notifications";

export const notificationKeys = {
  all: ["notifications"] as const,
  list: () => ["notifications", "list"] as const,
  unread: () => ["notifications", "unread"] as const,
};

/**
 * Escalations and AI flags age in minutes, so this refetches eagerly.
 *
 * The socket is what makes it live — `useTicketStream` invalidates this on
 * `notification.raised`. The interval below is the floor under that: a console
 * whose socket is down still catches up within a minute rather than sitting on
 * a stale bell until somebody navigates.
 */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: listNotifications,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/** The bell needs one number, not the feed — and asks the server for exactly that. */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: unreadNotificationCount,
    select: (count: { unread: number }) => count.unread,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't update the notification" },
    mutationFn: markNotificationRead,
    // Both keys: the row's badge and the topbar's count are the same fact
    // rendered in two places, and leaving one behind is how a bell ends up
    // claiming three unread over an all-read list.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't update the notifications" },
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
