import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrandPanel } from "@/components/auth/BrandPanel";
import { CredentialsStep } from "@/components/auth/CredentialsStep";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { useGoogleSignIn, useLogin } from "@/hooks/useAuth";
import { GOOGLE_CLIENT_ID, GOOGLE_SIGN_IN_ENABLED } from "@/lib/googleIdentity";
import { landingPath, useSession } from "@/store/session";

/**
 * Single-step sign-in against the live backend.
 *
 * Two doors, one session. A password (`/auth/login`) or a Google ID token
 * (`/auth/google`) — the backend answers both with the same payload, so
 * everything after `signInBackend` is identical. The password is never held in
 * this component, and neither is the Google credential: both are passed straight
 * to a mutation and dropped.
 *
 * `GoogleOAuthProvider` wraps this page rather than the app root on purpose. It
 * injects Google's ~100 KB script on mount, and `/login` is already the only
 * signed-out route (`RedirectIfSignedIn` guards it), so putting it here keeps
 * the script off every signed-in page, keeps `accounts.google.com` from seeing
 * internal page views, and avoids a second place that decides whether somebody
 * is signed in. This page is lazily routed, so the package stays out of the
 * initial chunk for free.
 */
export default function LoginPage() {
  const login = useLogin();
  const google = useGoogleSignIn();
  const navigate = useNavigate();

  /** Where a session goes once it exists. One path, not two. */
  function goToLanding() {
    const { superadmin, portal } = useSession.getState();
    navigate(landingPath({ superadmin, portal }), { replace: true });
  }

  async function handleCredential(credential: string) {
    try {
      await google.mutateAsync(credential);
      goToLanding();
    } catch {
      // Reported in the toaster by the global mutation handler.
    }
  }

  const form = (
    <CredentialsStep
      defaultEmail=""
      onSubmit={async (values) => {
        await login.mutateAsync({
          email: values.email,
          password: values.password,
        });
        // signInBackend has run; route by role.
        goToLanding();
      }}
      googleSlot={
        GOOGLE_SIGN_IN_ENABLED ? (
          <GoogleSignInButton
            onCredential={(c) => void handleCredential(c)}
          />
        ) : undefined
      }
    />
  );

  return (
    <>
      <PageMeta title="Sign in" description="Reliance GreenTech console sign-in." />
      <div className="grid min-h-svh md:grid-cols-[1.05fr_0.95fr]">
        <BrandPanel />

        <div className="flex items-center justify-center bg-surface px-8 py-10">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-90"
          >
            {/* Without a client id there is no provider, no button and no
                divider — password sign-in is untouched. That is what a Netlify
                deploy missing VITE_GOOGLE_CLIENT_ID looks like, and it must not
                take the login page down with it. */}
            {GOOGLE_SIGN_IN_ENABLED ? (
              <GoogleOAuthProvider
                clientId={GOOGLE_CLIENT_ID}
                onScriptLoadError={() => {
                  // Today a blocked accounts.google.com produces nothing at all.
                  if (import.meta.env.DEV) {
                    console.warn(
                      "[Google] the Identity Services script failed to load"
                    );
                  }
                }}
              >
                {form}
              </GoogleOAuthProvider>
            ) : (
              form
            )}
          </motion.div>
        </div>
      </div>
    </>
  );
}
