import { useGoogleOneTapLogin } from "@react-oauth/google";

/**
 * Google's One Tap prompt on the sign-in page.
 *
 * ⚠ Must be a component rendered INSIDE `GoogleOAuthProvider`, not a hook call
 * in the page that provides it: the hook reads the provider's context, and a
 * provider's own body sits outside its own context. Calling it in `LoginPage`
 * throws "Google OAuth components must be used within GoogleOAuthProvider" —
 * the single most common way this integration is wired wrong.
 *
 * Renders nothing. Google owns the prompt's markup and its position.
 *
 * **One Tap is the bonus, not the contract.** It silently never appears in a
 * browser with no Google session, in incognito, in Safari and Firefox (FedCM is
 * effectively Chromium-only), behind anything blocking accounts.google.com,
 * after three dismissals, or from an origin missing from the Google Cloud
 * client. The page must be complete without it — which it is: the button is
 * always there.
 */
export function GoogleOneTap({
  onCredential,
  disabled,
}: {
  onCredential: (credential: string) => void;
  /** True while signed in, or while a sign-in is already in flight. */
  disabled: boolean;
}) {
  useGoogleOneTapLogin({
    onSuccess: (response) => {
      if (response.credential) onCredential(response.credential);
    },
    onError: () => {
      if (import.meta.env.DEV) console.warn("[One Tap] failed");
    },
    // The library calls `google.accounts.id.cancel()` when this flips true, so
    // an open prompt is dismissed the moment a session lands rather than
    // hanging over the redirect.
    disabled,
    // ⚠ Defaults to false in the library, and without it the prompt silently
    // never appears in current Chrome — FedCM is now how this works.
    use_fedcm_for_prompt: true,
    // ⚠ Not optional. With auto-select on, signing out redirects to /login and
    // instantly signs the user back in, which makes sign-out look broken.
    auto_select: false,
    // A sign-in page's prompt should not vanish because somebody clicked the
    // email field.
    cancel_on_tap_outside: false,
    promptMomentNotification: (notification) => {
      if (!import.meta.env.DEV) return;
      // Under FedCM the browser owns the UI and several of these accessors are
      // unsupported or throw — the library's own types say so of
      // `opt_out_or_no_session`. Guarded because a diagnostic must not be the
      // thing that breaks the page.
      try {
        console.info(
          "[One Tap]",
          notification.getMomentType(),
          notification.isNotDisplayed?.()
            ? notification.getNotDisplayedReason?.()
            : notification.isSkippedMoment?.()
              ? notification.getSkippedReason?.()
              : ""
        );
      } catch {
        // Not diagnosable here; `[GSI_LOGGER]` lines in the console are.
      }
    },
  });

  return null;
}
