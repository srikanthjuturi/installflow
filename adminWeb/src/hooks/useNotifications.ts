import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type OpsNotification,
} from "@/services/notifications";

export const notificationKeys = {
  all: ["notifications"] as const,
  list: () => ["notifications", "list"] as const,
};

/** Escalations and AI flags age in minutes, so this refetches eagerly. */
const LIST_QUERY = {
  queryKey: notificationKeys.list(),
  queryFn: listNotifications,
  staleTime: 10_000,
  refetchOnWindowFocus: true,
};

export function useNotifications() {
  return useQuery(LIST_QUERY);
}

/**
 * The bell needs one number, not the feed. `select` narrows the result so the
 * topbar re-renders when the count moves — not every time a row is marked read.
 */
export function useUnreadNotificationCount() {
  return useQuery({
    ...LIST_QUERY,
    select: (items: OpsNotification[]) => items.filter((n) => !n.read).length,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
