/**
 * Lazy loader for the Google Maps JavaScript API.
 *
 * The browser SDK rather than the REST service at `places.googleapis.com`, for
 * two reasons: that host does not reliably send `Access-Control-Allow-Origin`,
 * and the JS path is the one that implements autocomplete **session tokens** —
 * without them every keystroke is billed as its own request instead of the
 * whole session being billed once, on selection.
 *
 * No dependency for this. `@googlemaps/js-api-loader` exists but it is a
 * wrapper over the same script tag, and `adminWeb/AGENTS.md` asks for a
 * dependency audit before anything joins the bundle. `@types/google.maps` is a
 * devDependency, so nothing here ships.
 *
 * Nothing imports this at module scope except `useAddressAutocomplete`, which
 * calls it from an effect — so the ~100 KB of Maps JS is fetched from Google's
 * CDN the first time an address field mounts, and never on a route without one.
 *
 * ⚠ **Readiness is the `callback` parameter, not the script's `load` event.**
 * With `loading=async` the tag fires `load` as soon as the bootstrap is parsed,
 * while `google.maps` is still being assembled — so resolving on `load` and
 * reaching for `google.maps.importLibrary` throws "is not a function", which is
 * exactly what it did. `callback` is the only thing Google promises means
 * "the API and every requested library are ready".
 */

/**
 * Read the same way `services/http.ts` reads the API base — a cast, since the
 * app declares no `ImportMetaEnv` and adding one for a single key would be a
 * second place to keep in step.
 */
const API_KEY = (
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
)?.trim();

/** Whether autocomplete can work at all. Callers render manual entry without it. */
export const MAPS_ENABLED = Boolean(API_KEY);

const SCRIPT_ID = "google-maps-js-api";

/**
 * The callback and its waiting list live on `window`, not in module scope, so
 * that an HMR reload — which re-evaluates this module but leaves the already
 * loaded script alone — joins the existing wait instead of starting a second
 * one that nothing would ever resolve.
 */
interface MapsWindow extends Window {
  __installflowMapsReady?: () => void;
  __installflowMapsWaiters?: Array<() => void>;
}

/** True once `google.maps.places` is actually usable. */
function ready(): boolean {
  return Boolean(window.google?.maps?.places?.AutocompleteSuggestion);
}

/**
 * Memoised, including the rejection.
 *
 * A failed load is a permanent condition for this page — a bad key, a blocked
 * host, an offline browser — so retrying it per keystroke would be a burst of
 * requests that cannot succeed. The component treats one rejection as "no
 * autocomplete on this page" and stops asking.
 */
let loading: Promise<typeof google.maps.places> | null = null;

export function loadPlacesLibrary(): Promise<typeof google.maps.places> {
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    if (!API_KEY) {
      reject(new Error("VITE_GOOGLE_MAPS_API_KEY is not set"));
      return;
    }
    if (ready()) {
      resolve();
      return;
    }

    const win = window as MapsWindow;
    // Queue first, so a second caller arriving mid-load is resolved by the same
    // callback rather than replacing it.
    (win.__installflowMapsWaiters ??= []).push(resolve);
    win.__installflowMapsReady ??= () => {
      const waiting = win.__installflowMapsWaiters ?? [];
      win.__installflowMapsWaiters = [];
      for (const done of waiting) done();
    };

    // The tag is appended once. A second module instance (HMR) finds it here
    // and simply waits on the queue above.
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    const params = new URLSearchParams({
      key: API_KEY,
      // Pinned to the weekly channel rather than `beta`: AutocompleteSuggestion
      // is generally available, and beta can change shape without notice.
      v: "weekly",
      // Keeps the fetch off the critical path. It also means `load` no longer
      // marks readiness — see the note at the top of this file.
      loading: "async",
      libraries: "places",
      callback: "__installflowMapsReady",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.addEventListener(
      "error",
      () => reject(new Error("Google Maps JS failed to load")),
      { once: true }
    );
    document.head.appendChild(script);
  }).then(() => {
    if (!ready()) throw new Error("Google Maps loaded without the places library");
    return google.maps.places;
  });

  return loading;
}
