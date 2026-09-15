import { useEffect, useRef } from 'react';
import type { ErrorUtils as RNErrorUtils } from 'react-native';

import { identifyClarity, initializeClarity } from '@/lib/analytics/clarity';
import { trackApiError } from '@/lib/analytics/events';
import { posthogClient, PostHogProvider } from '@/lib/analytics/posthog';
import { useSession } from '@/store/session.store';

/**
 * One-time analytics bring-up, mounted once around the router tree in
 * `app/_layout.tsx`.
 *
 * GA4 needs no init call of its own — `ga4.ts` is a plain HTTP client, ready
 * the moment its env vars are read. PostHog's client is already constructed
 * at module load in `posthog.ts` (so `events.ts` can reach it outside React);
 * this component's job is Clarity's `initialize()` call, the global RN error
 * handler, and keeping identity in step with who is signed in.
 *
 * The module-level guard is what makes this safe under React 19 Strict Mode
 * (which double-invokes effects in development) and Fast Refresh — Clarity's
 * `initialize` and the error-handler wrap must each run exactly once per
 * process, not once per mount.
 */
let bootstrapped = false;

function bootstrapAnalytics(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  initializeClarity();

  // Wrap RN's uncaught-error handler rather than replace it — Expo/React
  // Native's own handler (the red screen in dev, the native crash reporter
  // in production) must still run. `global.ErrorUtils` has no typed default
  // export in RN's own types, hence the cast.
  const errorUtils = (global as unknown as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (errorUtils) {
    const previousHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      trackApiError(error, { isFatal, source: 'uncaught' });
      previousHandler(error, isFatal);
    });
  }
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(bootstrapAnalytics, []);

  const technician = useSession((s) => s.technician);
  // Tracks whether a technician was signed in on the previous render, so a
  // transition to `null` can be told apart from booting up already signed
  // out — only the FORMER is a sign-out worth resetting PostHog for.
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (technician) {
      posthogClient?.identify(technician.id);
      identifyClarity(technician.id);
      wasSignedIn.current = true;
    } else if (wasSignedIn.current) {
      posthogClient?.reset();
      wasSignedIn.current = false;
    }
  }, [technician]);

  if (!posthogClient) return <>{children}</>;

  // `autocapture={false}`: the provider otherwise tracks screens on its own
  // (doubling `trackScreenView`'s) and reads the labels of what is touched,
  // which on a job screen is the customer.
  return (
    <PostHogProvider client={posthogClient} autocapture={false}>
      {children}
    </PostHogProvider>
  );
}
