import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { PAGE_META } from "@/components/shared/routeMeta";
import { useSession } from "@/store/session";
import { clarityIdentify, initClarity } from "./clarity";
import { initGA4 } from "./ga4";
import { initPostHog, isPostHogReady, posthog } from "./posthog";
import { trackScreenView } from "./events";

/**
 * Logic-only wrapper: initializes the three integrations once, identifies /
 * resets the analytics identity as the session signs in and out, and tracks
 * a page view on every route change. Renders nothing of its own.
 *
 * Mounted inside `BrowserRouter` in `App.tsx` so `useLocation` sees real
 * route changes — react-router transitions keep the previous committed tree
 * during a lazy-chunk load (see `lib/bootSplash.ts`), so this only fires once
 * a route has actually rendered, not on the redirect-through in between.
 */
export function AnalyticsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guards the three `init*()` calls against StrictMode's double-invoked
  // effect in dev. Each `init*()` is independently idempotent already (see
  // their own `initialized` module flags), so this is a belt-and-braces
  // guard against calling them at all, not the only thing preventing a
  // double `<script>` tag.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    initGA4();
    initClarity();
    initPostHog();
  }, []);

  const backendUser = useSession((s) => s.backendUser);
  const activeCompanyId = useSession((s) => s.activeCompanyId);
  const signedIn = useSession((s) => s.signedIn);
  const wasSignedIn = useRef(signedIn);

  useEffect(() => {
    if (signedIn && backendUser) {
      // The id only, never the email: it is enough to find the person in our
      // own database, and it is not personal data in somebody else's.
      if (isPostHogReady()) {
        posthog.identify(backendUser.id, {
          role: backendUser.role,
          company_id: activeCompanyId ?? undefined,
        });
      }
      clarityIdentify(backendUser.id, {
        role: backendUser.role,
        ...(activeCompanyId ? { companyId: activeCompanyId } : {}),
      });
    } else if (wasSignedIn.current && !signedIn) {
      // Just transitioned to signed-out — drop the identity so the next
      // person on this machine is not folded into the previous one's trail.
      if (isPostHogReady()) posthog.reset();
    }
    wasSignedIn.current = signedIn;
  }, [signedIn, backendUser, activeCompanyId]);

  const location = useLocation();
  useEffect(() => {
    const { title } = PAGE_META(location.pathname);
    trackScreenView(location.pathname, title ?? location.pathname);
  }, [location.pathname]);

  return children;
}
