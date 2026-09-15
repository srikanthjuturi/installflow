import type { PostHogEventProperties } from '@posthog/core';

import { setClarityScreenName } from '@/lib/analytics/clarity';
import { gaEvent } from '@/lib/analytics/ga4';
import { posthogClient } from '@/lib/analytics/posthog';

/**
 * The event taxonomy, in one place, so a call site never talks to a backend
 * directly.
 *
 * Tool split (see AGENTS.md / the approved plan):
 * - GA4: coarse business/conversion KPIs only.
 * - PostHog: everything else — full-detail conversion events AND every error,
 *   which never reaches GA.
 * - Clarity: automatic once initialized; `trackScreenView` is the one place
 *   this file also tags it, so a session replay can be found by route.
 *
 * Every helper here is a no-op when its backend(s) are unconfigured — `gaEvent`
 * and `posthogClient` already guard themselves, so these never need to check
 * env vars again.
 */

function posthogCapture(event: string, properties?: PostHogEventProperties): void {
  posthogClient?.capture(event, properties);
}

/** Screen views: GA4 + PostHog, and tags the Clarity session so a recording
 *  can be found by route rather than only by time. */
export function trackScreenView(pathname: string): void {
  gaEvent('screen_view', { screen_name: pathname });
  void posthogClient?.screen(pathname);
  setClarityScreenName(pathname);
}

/**
 * API and uncaught RN errors — PostHog only, never GA.
 *
 * `context` is intentionally loose (`Record<string, unknown>`, not
 * `PostHogEventProperties`) — callers pass whatever is on hand at the error
 * site (an `isFatal` that may be `undefined`, an `ApiError.code` that may be
 * `undefined`), and PostHog's own JSON transport already drops keys it
 * cannot serialize, so this never needs to filter them itself.
 */
export function trackApiError(error: unknown, context?: Record<string, unknown>): void {
  posthogClient?.captureException(error, context as unknown as PostHogEventProperties | undefined);
}

export function trackSignIn(success: boolean): void {
  gaEvent('sign_in', { success });
  posthogCapture('sign_in', { success });
}

/** Viewed and lost-race are diagnostic funnel detail — PostHog only. GA gets
 *  the conversion ("accepted") alone. */
export function trackJobOfferViewed(jobId: string): void {
  posthogCapture('job_offer_viewed', { jobId });
}

export function trackJobAccepted(jobId: string): void {
  gaEvent('job_accepted', { jobId });
  posthogCapture('job_accepted', { jobId });
}

export function trackJobAcceptLostRace(jobId: string): void {
  posthogCapture('job_accept_lost_race', { jobId });
}

export function trackJobCancelled(jobId: string, band: string): void {
  gaEvent('job_cancelled', { jobId, band });
  posthogCapture('job_cancelled', { jobId, band });
}

export function trackJobRescheduled(jobId: string): void {
  gaEvent('job_rescheduled', { jobId });
  posthogCapture('job_rescheduled', { jobId });
}

export function trackProofSubmitted(jobId: string): void {
  gaEvent('proof_submitted', { jobId });
  posthogCapture('proof_submitted', { jobId });
}

export function trackRedemptionRequested(amountPaise: number): void {
  gaEvent('redemption_requested', { amountPaise });
  posthogCapture('redemption_requested', { amountPaise });
}

export function trackRedemptionConfirmed(redemptionId: string): void {
  gaEvent('redemption_confirmed', { redemptionId });
  posthogCapture('redemption_confirmed', { redemptionId });
}

export function trackUpiAdded(): void {
  gaEvent('upi_added');
  posthogCapture('upi_added');
}

export function trackUpiChangeRequested(): void {
  gaEvent('upi_change_requested');
  posthogCapture('upi_change_requested');
}
