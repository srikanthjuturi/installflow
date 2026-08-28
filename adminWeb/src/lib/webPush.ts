/**
 * Talking to the browser's push machinery.
 *
 * Everything here is the DOM half of desktop alerts: registering the worker,
 * asking permission, and turning a `PushSubscription` into something the API
 * can store. Nothing in this file knows about notifications, and nothing in it
 * calls the API — `useWebPush` joins the two.
 */

/** Where the worker lives. A stable path on purpose — see `public/_headers`. */
const SW_URL = "/sw.js";

/** Anything the worker sends the page. Kept in step with `public/sw.js`. */
export const PAGE_MESSAGE = "reliancegreentech.notification";

/** What the worker posts when a push arrives and this tab is visible. */
export interface PushMessage {
  type: typeof PAGE_MESSAGE;
  title: string;
  body: string;
  data: { id?: string; kind?: string; to?: string };
}

/** What the API stores — `PushSubscription.toJSON()`, flattened. */
export interface WebPushKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Can this browser do desktop alerts at all?
 *
 * Three separate capabilities, and a browser can have one without the others —
 * iOS Safari has `Notification` on the window long before a page is installed
 * to the home screen, and `PushManager` is what actually decides.
 */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** `default` (never asked), `granted`, or `denied`. */
export function permissionState(): NotificationPermission {
  return isWebPushSupported() ? Notification.permission : "denied";
}

/**
 * The VAPID public key, base64url, as the bytes `subscribe` wants.
 *
 * Base64url is not base64: the alphabet swaps two characters and the padding is
 * dropped, so it has to be put back before `atob` will take it.
 */
function applicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(
    base64Url.length + ((4 - (base64Url.length % 4)) % 4),
    "="
  );
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  // Backed by a real ArrayBuffer rather than a view over a shared one:
  // `applicationServerKey` takes a BufferSource, and TypeScript distinguishes
  // the two.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Base64url for the two keys, which arrive as raw bytes. */
function encodeKey(subscription: PushSubscription, name: "p256dh" | "auth"): string {
  const raw = subscription.getKey(name);
  if (!raw) return "";
  let binary = "";
  const bytes = new Uint8Array(raw);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function flatten(subscription: PushSubscription): WebPushKeys {
  return {
    endpoint: subscription.endpoint,
    p256dh: encodeKey(subscription, "p256dh"),
    auth: encodeKey(subscription, "auth"),
  };
}

/**
 * Register the worker, once per page load.
 *
 * `navigator.serviceWorker.register` is idempotent — calling it with the same
 * URL returns the existing registration rather than installing a second worker
 * — so this is safe to call from anywhere that needs one.
 */
export async function registerWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SW_URL, {
    scope: "/",
  });
  // A registration that is still installing has no `pushManager` to subscribe
  // with. `ready` resolves once one is active and controlling the page.
  await navigator.serviceWorker.ready;
  return registration;
}

/** The subscription this browser already holds, if any. */
export async function currentSubscription(): Promise<WebPushKeys | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  const existing = await registration?.pushManager.getSubscription();
  return existing ? flatten(existing) : null;
}

/**
 * Ask for permission and subscribe. Returns null if permission was refused.
 *
 * Must be called from a user gesture. Browsers increasingly refuse — or
 * silently auto-deny — a permission prompt that no click led to, which is why
 * the only caller is the toggle.
 */
export async function subscribe(publicKey: string): Promise<WebPushKeys | null> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = await registerWorker();

  // A subscription already here is reused rather than replaced: re-subscribing
  // mints a new endpoint and orphans the row the API is holding.
  const existing = await registration.pushManager.getSubscription();
  if (existing) return flatten(existing);

  const created = await registration.pushManager.subscribe({
    // Required, and true is the only accepted value in Chrome: every push must
    // result in something the user can see. The worker honours that — it either
    // shows a notification or hands the push to a visible tab.
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  return flatten(created);
}

/**
 * Drop this browser's subscription. Returns what it was, for the API call.
 *
 * The permission itself is untouched — only the user can revoke that, in
 * browser settings — so turning alerts back on later needs no second prompt.
 */
export async function unsubscribe(): Promise<WebPushKeys | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  const existing = await registration?.pushManager.getSubscription();
  if (!existing) return null;
  const keys = flatten(existing);
  await existing.unsubscribe();
  return keys;
}
