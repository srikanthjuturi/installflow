import * as SecureStore from 'expo-secure-store';

import { GA_API_SECRET, GA_ENABLED, GA_MEASUREMENT_ID } from '@/lib/analytics/config';

/**
 * GA4 via the Measurement Protocol — a plain HTTPS POST, not the Firebase SDK.
 *
 * GA4 here is for coarse, business-facing KPIs only (screen views, sign-in,
 * job accepted, …) — see `events.ts`. Errors and fine-grained detail are
 * PostHog's job, never GA's.
 *
 * `client_id` is GA4's anonymous device identifier. It has nothing to do with
 * `useSession`'s technician id — GA4 wants a stable per-DEVICE id that survives
 * sign-out, so it is minted once and kept in SecureStore under its own key,
 * independent of the session store's lifecycle.
 */

const CLIENT_ID_KEY = 'reliancegreentech.ga_client_id';

/** RFC-4122-ish v4 UUID. No crypto dependency: this id is not a secret, only
 *  a bucket for anonymous counting, so `Math.random` is good enough. */
function generateClientId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let clientIdPromise: Promise<string> | null = null;

// One GA session per app process. Measurement Protocol events without a
// `session_id` and `engagement_time_msec` never appear in Realtime or in any
// session-based report — they are collected and then quietly left out.
const SESSION_ID = String(Math.floor(Date.now() / 1000));

/** Read the persisted id, minting and storing one on first launch. Cached for
 *  the life of the process so every `gaEvent` after the first is synchronous
 *  from this module's point of view. */
function getClientId(): Promise<string> {
  if (!clientIdPromise) {
    clientIdPromise = (async () => {
      try {
        const existing = await SecureStore.getItemAsync(CLIENT_ID_KEY);
        if (existing) return existing;

        const fresh = generateClientId();
        await SecureStore.setItemAsync(CLIENT_ID_KEY, fresh);
        return fresh;
      } catch {
        // A SecureStore failure must not block analytics or crash the caller —
        // fall back to a per-session id that is simply not durable.
        return generateClientId();
      }
    })();
  }
  return clientIdPromise;
}

/**
 * Fire-and-forget: a GA4 event never blocks its caller and never throws.
 * Matches the codebase's existing "floor, not audit" pattern for
 * fire-and-forget counting (see the vendor address-search reporting).
 *
 * A no-op when `EXPO_PUBLIC_GA_MEASUREMENT_ID` / `EXPO_PUBLIC_GA_API_SECRET`
 * are unset, which is the default on a build with no analytics keys.
 */
export function gaEvent(name: string, params?: Record<string, unknown>): void {
  if (!GA_ENABLED) return;

  void (async () => {
    try {
      const client_id = await getClientId();
      await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`,
        {
          method: 'POST',
          body: JSON.stringify({
            client_id,
            events: [
              {
                name,
                params: {
                  session_id: SESSION_ID,
                  engagement_time_msec: 1,
                  ...params,
                },
              },
            ],
          }),
        },
      );
    } catch {
      // Dropped. A missed GA4 event is a gap in a dashboard, never a crash.
    }
  })();
}
