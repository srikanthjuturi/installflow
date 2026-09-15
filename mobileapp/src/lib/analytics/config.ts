/**
 * Where every analytics backend reads its credentials from.
 *
 * Production builds only. The keys live in `eas.json`'s `production` profile
 * and nowhere else, and `__DEV__` is a second lock: Expo Go and dev-client
 * builds never track, even if somebody puts keys in a local `.env`. The
 * `preview` profile is a release build, so it stays off by having no keys.
 *
 * Nothing here throws on a missing value: an unset var turns that ONE backend
 * off, and the app behaves exactly like one with tracking removed.
 */

const IS_PROD = !__DEV__;

export const GA_MEASUREMENT_ID = process.env.EXPO_PUBLIC_GA_MEASUREMENT_ID || '';
export const GA_API_SECRET = process.env.EXPO_PUBLIC_GA_API_SECRET || '';
export const GA_ENABLED = IS_PROD && Boolean(GA_MEASUREMENT_ID && GA_API_SECRET);

export const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY || '';
export const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
export const POSTHOG_ENABLED = IS_PROD && Boolean(POSTHOG_KEY);

export const CLARITY_PROJECT_ID = process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID || '';
export const CLARITY_ENABLED = IS_PROD && Boolean(CLARITY_PROJECT_ID);
