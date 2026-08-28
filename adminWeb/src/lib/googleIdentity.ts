/**
 * Google Sign-In configuration for the console's login page.
 *
 * One place for the `import.meta.env` cast, exactly as `lib/googleMaps.ts` is
 * for the Maps key — and for the same reason: the app declares no
 * `ImportMetaEnv`, and adding one for a single key would be a second place to
 * keep in step.
 *
 * A `VITE_*` value is inlined into the bundle, so this client id is PUBLIC by
 * design — that is what a client id is. There is no client secret anywhere in
 * the console or the API: the browser receives a signed ID token directly, with
 * no authorization code and therefore no exchange for a secret to sign.
 *
 * It must match `GOOGLE_CLIENT_ID` on the API, which keeps it as a default in
 * `app/core/config.py`. A mismatch fails every sign-in with a bare 401.
 */

const CLIENT_ID = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
)?.trim();

/**
 * Whether the login page offers Google at all. Unset — which is what a Netlify
 * deploy that forgot the variable looks like — renders no button and no
 * divider, and password sign-in is unaffected.
 */
export const GOOGLE_SIGN_IN_ENABLED = Boolean(CLIENT_ID);

export const GOOGLE_CLIENT_ID = CLIENT_ID ?? "";

if (import.meta.env.DEV && !CLIENT_ID) {
  // An unset key is otherwise indistinguishable from a broken integration:
  // nothing renders and nothing errors. Same idea as `MAPS_ENABLED`.
  console.warn(
    "VITE_GOOGLE_CLIENT_ID is not set — the Google sign-in button is hidden."
  );
}
