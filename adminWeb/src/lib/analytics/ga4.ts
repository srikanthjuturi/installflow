/**
 * Google Analytics 4 — hand-rolled `gtag.js` loader.
 *
 * No package for this: it is a `<script>` tag and two global calls, and a
 * dependency for that is more surface than the thing it wraps. GA carries only
 * coarse business/conversion KPIs (screen views, sign-in, ticket raised, …) —
 * see `events.ts` for the segregation with PostHog.
 *
 * `index.html` is a static file with no Vite env templating (see its own
 * brand-sync comment block), so the script has to be injected from here at
 * runtime rather than hardcoded there.
 */

import { GA_ENABLED, GA_MEASUREMENT_ID } from "./config";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initialized = false;

/**
 * Loads `gtag.js` and configures it with page views off — `AnalyticsProvider`
 * sends page views itself on every route change, since GA's automatic
 * pageview fires before React Router has committed the real path.
 *
 * Safe to call more than once (React 18/19 StrictMode double-invokes effects
 * in dev): the second call is a no-op.
 */
export function initGA4(): void {
  if (!GA_ENABLED || initialized) return;
  initialized = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the standard gtag.js snippet, verbatim
  function gtag(...args: any[]) {
    window.dataLayer!.push(args);
  }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
}

/** No-op when GA isn't initialized — every call site can call this freely. */
export function gaEvent(name: string, params?: Record<string, unknown>): void {
  if (!initialized || !window.gtag) return;
  window.gtag("event", name, params);
}

/** Manual page view — `send_page_view: false` above is what makes this the only one. */
export function gaPageView(path: string, title: string): void {
  if (!initialized || !window.gtag) return;
  window.gtag("event", "page_view", { page_path: path, page_title: title });
}
