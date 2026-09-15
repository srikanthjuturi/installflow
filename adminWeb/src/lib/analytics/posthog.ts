/**
 * PostHog — exception/error capture AND the same conversion events GA4 gets,
 * with full property detail for funnels. Errors are PostHog-only, never sent
 * to GA — see `events.ts`.
 *
 * Session replay is deliberately OFF here: Clarity is the replay tool, and a
 * second recorder would only be a second copy of every customer name, phone
 * and address this console shows. For the same reason autocapture keeps the
 * element, never its text — a clicked ticket row's text IS the customer.
 */

import posthog from "posthog-js";
import { POSTHOG_ENABLED, POSTHOG_HOST, POSTHOG_KEY } from "./config";

let initialized = false;

/** No-op when no key is configured. Safe to call more than once. */
export function initPostHog(): void {
  if (!POSTHOG_ENABLED || initialized) return;
  initialized = true;
  posthog.init(POSTHOG_KEY!, {
    api_host: POSTHOG_HOST,
    // Sent manually on route change beside GA's — see `trackScreenView`.
    capture_pageview: false,
    autocapture: true,
    capture_exceptions: true,
    person_profiles: "identified_only",
    disable_session_recording: true,
    mask_all_text: true,
  });
}

/** `posthog-js` logs a warning for calls made before `init`, so callers check this first. */
export function isPostHogReady(): boolean {
  return initialized;
}

export { posthog };
