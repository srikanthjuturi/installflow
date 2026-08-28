import { useSyncExternalStore } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useTheme } from "@/components/theme-provider";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

/**
 * "light" | "dark", with `system` resolved.
 *
 * The theme context exposes the PREFERENCE, which may be `system`; Google's
 * button needs a concrete one. Resolved here rather than by widening the
 * provider, because this is the only caller that needs it.
 *
 * `useSyncExternalStore` rather than an effect: `matchMedia` is exactly the
 * external store it exists for, and subscribing with an effect means a second
 * render on every mount.
 */
function useResolvedTheme(): "light" | "dark" {
  const { theme } = useTheme();
  const systemDark = useSyncExternalStore(
    subscribeToScheme,
    systemPrefersDark,
    // Server snapshot; there is no SSR here, but the signature wants it.
    () => false
  );

  if (theme === "system") return systemDark ? "dark" : "light";
  return theme === "dark" ? "dark" : "light";
}

/**
 * Google's "Continue with Google" button, AND the One Tap prompt.
 *
 * ⚠ Both come from this ONE component on purpose. `useGoogleOneTapLogin` in a
 * second component works, but it calls `google.accounts.id.initialize()` a
 * second time — Google logs *"initialize() is called multiple times … only the
 * last initialized instance will be used"*, which means one of the two
 * callbacks is silently the loser. `useOneTap` on the button is the library's
 * own way to have both, and it initialises once.
 *
 * It also removes the need to reason about when One Tap may prompt: it prompts
 * exactly where this button renders, which is `/login`, which `RedirectIfSignedIn`
 * already restricts to signed-out visitors.
 *
 * ⚠ Must be rendered INSIDE `GoogleOAuthProvider`, not beside it: it reads the
 * provider's context, and a provider's own body sits outside its own context.
 * That is why this is a component rather than markup in `LoginPage`.
 *
 * Google draws the button in an iframe, so its font, colours and radius are
 * theirs and cannot be restyled — which also means the design-system rules about
 * hexes and tokens apply only to the wrapper here. The trade is that the label
 * is Google's own approved string, so their branding guidelines are satisfied by
 * construction.
 */
export function GoogleSignInButton({
  onCredential,
}: {
  /** The Google ID token. Handed straight to the mutation, never stored. */
  onCredential: (credential: string) => void;
}) {
  const resolvedTheme = useResolvedTheme();

  return (
    // ⚠ Reserve the height. `GoogleLogin` renders an empty container until
    // Google's script has loaded, so without this the caption below it jumps as
    // the page settles.
    <div className="flex min-h-11 justify-center">
      <GoogleLogin
        onSuccess={(response) => {
          if (response.credential) onCredential(response.credential);
        }}
        onError={() => {
          // GSI gives no reason here. The toaster reports the API failure; this
          // is the case where Google itself refused before we were involved.
          if (import.meta.env.DEV) console.warn("[Google] sign-in failed");
        }}
        // The One Tap prompt, from the same initialise as the button.
        useOneTap
        // ⚠ Not optional: without it the prompt silently never appears in
        // current Chrome, where FedCM is now how this works.
        use_fedcm_for_prompt
        // ⚠ Also not optional. With auto-select on, signing out redirects to
        // /login and instantly signs the user back in, which makes sign-out
        // look broken.
        auto_select={false}
        // A sign-in page's prompt should not vanish because somebody clicked
        // the email field.
        cancel_on_tap_outside={false}
        // ⚠ No `promptMomentNotification`. The whole PromptMomentNotification
        // family — getMomentType, isNotDisplayed, getSkippedReason — is
        // deprecated under FedCM, and merely reading any of it makes Google log
        // a standing warning on every page load.
        //
        // Nothing is lost: Google's own `[GSI_LOGGER]` lines say more than that
        // callback ever could. "The given origin is not allowed for the given
        // client ID" is the diagnosis for the failure people actually hit, and
        // it appears without us asking.
        // `outline` is a white button and would sit badly on the dark panel.
        theme={resolvedTheme === "dark" ? "filled_black" : "outline"}
        text="continue_with"
        shape="rectangular"
        size="large"
        logo_alignment="left"
        // ⚠ A NUMBER of pixels, max 400 — it does not accept "100%", so this
        // cannot stretch to `w-full` like the Sign in button above it. 360
        // matches the panel's `max-w-90`.
        width={360}
      />
    </div>
  );
}
