import { mockResponse, notFound } from "./client";

/**
 * Operational events worth interrupting someone for. There are exactly four —
 * the same four the dashboard surfaces under "Needs your attention", because a
 * bell that rings for anything else is a bell people stop reading.
 */
export type NotificationKind = "escalation" | "ai" | "force-close" | "slot";

export interface OpsNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  /** The screen that clears the event — a notification is a work item, not a note. */
  to: string;
  when: string;
  read: boolean;
}

const NOTIFICATIONS: OpsNotification[] = [
  {
    id: "NTF-1041",
    kind: "escalation",
    title: "INST-240988 escalated",
    detail: "No technician accepted · 1h 05m to slot",
    to: "/escalations",
    when: "4m ago",
    read: false,
  },
  {
    id: "NTF-1040",
    kind: "ai",
    title: "Serial mismatch on INST-240931",
    detail: "62% confidence · Sunil Pawar",
    to: "/ai-review/INST-240931",
    when: "12m ago",
    read: false,
  },
  {
    id: "NTF-1039",
    kind: "slot",
    title: "INST-240955 slot not confirmed",
    detail: "Customer silent 6h · auto-escalated",
    to: "/tickets/INST-240955",
    when: "38m ago",
    read: false,
  },
  {
    id: "NTF-1038",
    kind: "escalation",
    title: "INST-240940 escalated",
    detail: "Cancelled 2× · unassigned · 3h 15m to slot",
    to: "/escalations",
    when: "1h ago",
    read: true,
  },
  {
    id: "NTF-1037",
    kind: "ai",
    title: "Low product-match confidence on INST-240960",
    detail: "48% confidence · Sunil Pawar",
    to: "/ai-review/INST-240960",
    when: "1h ago",
    read: true,
  },
  {
    id: "NTF-1036",
    kind: "force-close",
    title: "INST-240970 ready for force closure",
    detail: "No customer response for 48h",
    to: "/tickets/INST-240970",
    when: "2h ago",
    read: true,
  },
  {
    id: "NTF-1035",
    kind: "slot",
    title: "INST-240918 slot not confirmed",
    detail: "Customer silent 6h · auto-escalated",
    to: "/tickets/INST-240918",
    when: "3h ago",
    read: true,
  },
];

/**
 * Copies on the way out. `markRead` mutates the records in place, so handing
 * back the live objects would give the query the same identities it already
 * has and the list would never repaint.
 */
export function listNotifications(): Promise<OpsNotification[]> {
  return mockResponse(() => NOTIFICATIONS.map((n) => ({ ...n })));
}

export function markNotificationRead(id: string): Promise<OpsNotification> {
  return mockResponse(() => {
    const found = NOTIFICATIONS.find((n) => n.id === id);
    if (!found) notFound("Notification", id);
    found.read = true;
    return { ...found };
  });
}

export function markAllNotificationsRead(): Promise<{ read: number }> {
  return mockResponse(() => {
    const unread = NOTIFICATIONS.filter((n) => !n.read);
    for (const n of unread) n.read = true;
    return { read: unread.length };
  });
}
