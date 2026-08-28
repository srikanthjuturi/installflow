/**
 * The console's service worker. Notifications only — no caching, no offline.
 *
 * It exists for one case the page cannot cover: the console is in another tab,
 * or shut altogether, and something happened that somebody has to act on. A
 * page that is not running cannot show anything, so the browser's push service
 * wakes this worker instead.
 *
 * ## Who shows what
 *
 * The split with the page is strict, and it is what stops a notification
 * appearing twice:
 *
 *   * a client is VISIBLE   -> hand it to the page, which shows a toast
 *   * no client is visible  -> show an operating-system notification here
 *
 * Skipping `showNotification` is allowed precisely because a visible client is
 * already telling the user; browsers permit a silent push in that case and in
 * no other. Never return without doing one or the other, or the browser starts
 * showing its own "this site was updated in the background" instead.
 *
 * The page dedupes by notification id, so it does not matter whether a toast
 * was triggered by the websocket or by the message below — whichever arrives
 * first wins and the second is dropped. That redundancy is deliberate: it is
 * what covers a console whose socket is down but whose push still works.
 */

/** Anything this worker sends the page. Kept in step with useNotificationToasts.ts. */
const PAGE_MESSAGE = "reliancegreentech.notification";

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close. A worker
  // that only activates tomorrow is a worker nobody can test today.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event.data));
});

async function handlePush(data) {
  let payload = {};
  try {
    payload = data ? data.json() : {};
  } catch {
    // A push with no body, or one this version does not understand. Fall
    // through: the generic notification below still sends somebody to look,
    // which is better than swallowing it.
  }

  const title = payload.title || "Reliance GreenTech";
  const body = payload.body || "";
  const info = payload.data || {};

  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const visible = clients.filter((client) => client.visibilityState === "visible");

  if (visible.length > 0) {
    for (const client of visible) {
      client.postMessage({ type: PAGE_MESSAGE, title, body, data: info });
    }
    return;
  }

  await self.registration.showNotification(title, {
    body,
    // The notification's own id, so a repeat about the same event REPLACES the
    // one already on screen rather than stacking a second copy beside it.
    tag: info.id || undefined,
    renotify: Boolean(info.id),
    data: info,
    // Deliberately no `icon`: the only brand asset here is an SVG, and Chrome
    // will not decode one for a notification. A missing icon falls back to the
    // browser's own, which is better than a broken one.
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTarget(event.notification.data || {}));
});

/**
 * Focus the console on the screen that DEALS with the event.
 *
 * `to` comes from the notification row and is always an in-app path. It is
 * checked anyway — this value has travelled through a push service, and a
 * worker that would open any URL handed to it is a worker worth attacking.
 */
async function openTarget(info) {
  const path =
    typeof info.to === "string" && info.to.startsWith("/") && !info.to.startsWith("//")
      ? info.to
      : "/notifications";
  const url = new URL(path, self.location.origin).href;

  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clients) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    // Reuse the console already open rather than opening a second one. A
    // manager with two tabs of the same screen is a manager who marks the
    // same escalation read twice.
    await client.focus();
    if ("navigate" in client) {
      try {
        await client.navigate(url);
      } catch {
        // Cross-document navigation can be refused; the tab is focused, which
        // is most of what the click asked for.
      }
    }
    return;
  }

  await self.clients.openWindow(url);
}
