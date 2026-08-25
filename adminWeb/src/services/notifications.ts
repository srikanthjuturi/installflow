import { apiGet, apiPost } from "./http";

/**
 * Operational events worth interrupting someone for.
 *
 * The spellings are the server's, verbatim — `force_close`, not `force-close`.
 * A translation layer between the two would be one more place for a kind to go
 * missing, and the only thing it would buy is a hyphen.
 */
export type NotificationKind =
  | "escalation"
  | "ai"
  | "serial_mismatch"
  | "force_close"
  | "slot";

export interface OpsNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  /** The screen that clears the event — a notification is a work item, not a note. */
  to: string;
  /**
   * An instant, not "4m ago". The server sends what happened when; how long ago
   * that was is the reader's clock's business, and a string built server-side
   * is already stale by the time it paints.
   */
  createdAt: string;
  /** Per THIS reader — the same escalation is dealt with by one manager and not another. */
  read: boolean;
}

export interface UnreadCount {
  unread: number;
}

/** This reader's feed, newest first. Who may see what is decided server-side. */
export function listNotifications(): Promise<OpsNotification[]> {
  return apiGet<OpsNotification[]>("/notifications");
}

/**
 * Just the number, for the bell.
 *
 * Its own endpoint rather than `list().length`: the topbar renders on every
 * screen, and reading a whole feed to draw a badge costs a query per navigation.
 */
export function unreadNotificationCount(): Promise<UnreadCount> {
  return apiGet<UnreadCount>("/notifications/unread");
}

export function markNotificationRead(id: string): Promise<UnreadCount> {
  return apiPost<UnreadCount>(`/notifications/${id}/read`);
}

export function markAllNotificationsRead(): Promise<UnreadCount> {
  return apiPost<UnreadCount>("/notifications/read-all");
}
