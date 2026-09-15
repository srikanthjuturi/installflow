import PostHog, { PostHogProvider } from 'posthog-react-native';

import { POSTHOG_ENABLED, POSTHOG_HOST, POSTHOG_KEY } from '@/lib/analytics/config';

/**
 * PostHog is everything GA4 doesn't cover: exception/error capture (API
 * errors and uncaught RN errors — never sent to GA) and the same conversion
 * events as GA4, but with full property detail. See `events.ts`.
 *
 * A single module-level client, exported directly rather than only through
 * `usePostHog()` — `events.ts` is called from plain functions (mutation
 * hooks, `api.ts`) as well as components, so it needs an instance it can
 * reach without a hook.
 *
 * `null` when `EXPO_PUBLIC_POSTHOG_KEY` is unset. Every caller in this
 * directory checks for that before touching the client — see `events.ts`.
 */
export const posthogClient: PostHog | null = POSTHOG_ENABLED
  ? new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // Autocapture (touches, native lifecycle) is left to its defaults via
      // `PostHogProvider` below — this instance only needs to exist so
      // `events.ts` has something to call outside of React.
    })
  : null;

export { PostHogProvider };
