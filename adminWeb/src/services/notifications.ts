import { currentSubscription, unsubscribe } from "@/lib/webPush";
import { apiDelete, apiGet, apiGetPage, apiPost } from "./http";
import type { Page } from "@/types/api";

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
  | "slot"
  | "technician_joined"
  | "job_started"
  | "invite_expired"
  | "assigned"
  | "no_show";

/**
 * The same ten, in the order the filter offers them — loudest first.
 *
 * Problems lead, because that is what somebody opening this screen came for.
 * The last four are the things that merely HAPPENED — a job was taken, a
 * technician arrived, a visit began, an invite lapsed — and they sit at the
 * bottom for the same reason: nobody scrolls a feed looking for good news.
 *
 * `satisfies` rather than a plain array: drop a kind from the union and this
 * line stops compiling, which is the point. A filter that quietly stops
 * offering a category looks exactly like a category with nothing in it.
 */
export const NOTIFICATION_KINDS = [
  "escalation",
  "no_show",
  "serial_mismatch",
  "ai",
  "force_close",
  "slot",
  "invite_expired",
  "assigned",
  "job_started",
  "technician_joined",
] as const satisfies readonly NotificationKind[];

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

/**
 * What the reader has narrowed the feed to.
 *
 * All three narrow and none can widen — the audience is settled server-side
 * before any of them is applied, so a filter can only ever hide rows this
 * reader was already entitled to see.
 */
export interface NotificationQuery {
  /** Matches the title and the detail. The ticket code lives in the title. */
  search?: string;
  kind?: NotificationKind;
  unread?: boolean;
  page?: number;
  limit?: number;
}

/**
 * One page of this reader's feed, newest first.
 *
 * Paged rather than capped: the feed used to arrive as the 50 most recent rows
 * and stop, which is right for a bell and wrong for a screen somebody scrolls.
 */
export function listNotifications(
  query: NotificationQuery = {}
): Promise<Page<OpsNotification>> {
  const filters: Record<string, string> = {};
  if (query.kind) filters.kind = query.kind;
  // Only sent when it is on — `unread=false` is the default and saying so would
  // put a second cache key on the unfiltered feed.
  if (query.unread) filters.unread = "true";

  return apiGetPage<OpsNotification>("/notifications", {
    page: query.page,
    limit: query.limit,
    search: query.search?.trim() || undefined,
    filters,
  });
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

/**
 * The VAPID public key this deployment signs pushes with.
 *
 * Read from the API rather than baked in as a `VITE_` variable so there is one
 * source of truth, Netlify deploy previews need no build configuration of their
 * own, and rotating the pair does not need a frontend release.
 *
 * An empty string is a real answer: this deployment has no key, so desktop
 * alerts are unavailable rather than broken.
 */
export function webPushKey(): Promise<{ publicKey: string }> {
  return apiGet<{ publicKey: string }>("/notifications/web-push-key");
}

/** Where to reach this browser — `PushSubscription.toJSON()`, flattened. */
export interface WebPushRegistration {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

export function registerWebPush(body: WebPushRegistration): Promise<null> {
  return apiPost<null>("/notifications/web-devices", body);
}

/**
 * Stop pushing to this browser.
 *
 * Omitting the endpoint drops every subscription this user holds in this
 * company, which is what signing out and switching company send: a browser can
 * lose its subscription object while keeping the permission, and a row left
 * behind is one company's notification text on the screen of somebody now
 * working in another.
 */
export function unregisterWebPush(endpoint?: string): Promise<null> {
  return apiDelete<null>("/notifications/web-devices", { endpoint: endpoint ?? null });
}

/**
 * Stop desktop alerts reaching this browser, on the way out.
 *
 * Called before signing out, and it is not tidiness. A push carries the
 * notification's `detail`, which can name a customer; a subscription left
 * behind keeps delivering that to a machine nobody is signed in on — and if
 * the next person to use it works for another company, to the wrong one
 * entirely. `models/web_push_subscription.py` documents the same hazard from
 * the server's side.
 *
 * Best effort by design: this must never be the reason somebody cannot sign
 * out. The local `unsubscribe` is the half that matters most — once the browser
 * drops it, the push service answers 410 and the server prunes the row on its
 * next attempt regardless of whether the call below got through.
 */
export async function dropWebPush(): Promise<void> {
  const dropped = await unsubscribe().catch(() => null);
  await unregisterWebPush(dropped?.endpoint).catch(() => {});
}

/**
 * Re-point this browser's subscription at the newly active company.
 *
 * Called after switching company, and one call is enough: registration upserts
 * on the endpoint and rewrites `company_id`, so the row MOVES rather than
 * being duplicated or orphaned. Deleting and re-creating would leave a window
 * with no subscription at all, and a browser that stopped alerting silently
 * mid-switch is the failure nobody would think to report.
 */
export async function moveWebPushToActiveCompany(): Promise<void> {
  const existing = await currentSubscription().catch(() => null);
  if (!existing) return;
  await registerWebPush({
    ...existing,
    userAgent: navigator.userAgent.slice(0, 255),
  }).catch(() => {});
}
