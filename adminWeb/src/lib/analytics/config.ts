/**
 * Analytics configuration — read once, from `import.meta.env`.
 *
 * Every key here is optional. Unset means "this integration is off", not "this
 * app is broken" — the same contract `VITE_GOOGLE_MAPS_API_KEY` already has
 * (see `lib/googleMaps.ts`). Nothing in `lib/analytics/` may throw when a key
 * is missing; every init function below checks these booleans first and
 * no-ops otherwise.
 *
 * A `VITE_*` value is inlined into the bundle at build time, so — like the
 * Google keys in `.env.example` — none of these are secrets. GA's measurement
 * id, Clarity's project id and PostHog's project key are all meant to ship in
 * client JavaScript; that is what each product's own SDK expects.
 */

export const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as
  | string
  | undefined;

export const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID as
  | string
  | undefined;

export const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as
  | string
  | undefined;

/** PostHog's own default region host when a key is set but no host is given. */
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  DEFAULT_POSTHOG_HOST;

// Production builds only. `npm run dev` never tracks, even with keys in `.env`;
// the ids are also simply left unset in every deployed build but prod's, which
// keeps the dev App Service out too.
const IS_PROD = import.meta.env.PROD;

export const GA_ENABLED = IS_PROD && Boolean(GA_MEASUREMENT_ID);
export const CLARITY_ENABLED = IS_PROD && Boolean(CLARITY_PROJECT_ID);
export const POSTHOG_ENABLED = IS_PROD && Boolean(POSTHOG_KEY);
