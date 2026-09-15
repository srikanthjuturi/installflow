/**
 * Typed event helpers — the only thing the rest of the console imports from
 * `lib/analytics/`. Each fans out to the right backend(s):
 *
 *  - GA4:     coarse business/conversion KPIs only.
 *  - PostHog: the same conversion events with full detail for funnels, PLUS
 *             every error — API errors and uncaught JS exceptions.
 *  - Clarity: nothing here. It is automatic once initialized; its only calls
 *             are `clarityIdentify` / `clarityTag`, from `AnalyticsProvider`.
 *
 * Every helper is a no-op for a backend that is not configured.
 */

import { gaEvent, gaPageView } from "./ga4";
import { isPostHogReady, posthog } from "./posthog";

function capture(name: string, properties?: Record<string, unknown>): void {
  if (isPostHogReady()) posthog.capture(name, properties);
}

/** Both events carry the path only: a query string can hold a searched phone number. */
export function trackScreenView(path: string, title: string): void {
  gaPageView(path, title);
  capture("$pageview", {
    $current_url: window.location.origin + path,
    title,
  });
}

export function trackSignIn(
  method: "password" | "google",
  success: boolean
): void {
  gaEvent("sign_in", { method, success });
  capture("sign_in", { method, success });
}

/** PostHog only — GA carries no error data. */
export function trackApiError(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (isPostHogReady()) posthog.captureException(error, context);
}

export function trackTicketRaised(ticketId: string, companyId: string): void {
  gaEvent("ticket_raised", { ticket_id: ticketId, company_id: companyId });
  capture("ticket_raised", { ticket_id: ticketId, company_id: companyId });
}

/** `reason` is the `ApiError.code` when the API gives one, e.g. `"OUT_OF_CREDITS"`. */
export function trackTicketRaiseFailed(reason: string): void {
  gaEvent("ticket_raise_failed", { reason });
  capture("ticket_raise_failed", { reason });
}

export function trackJobCancelledByManager(
  ticketId: string,
  reason?: string
): void {
  gaEvent("job_cancelled", { ticket_id: ticketId, reason });
  capture("job_cancelled", { ticket_id: ticketId, reason });
}

export function trackJobRescheduledByManager(ticketId: string): void {
  gaEvent("job_rescheduled", { ticket_id: ticketId });
  capture("job_rescheduled", { ticket_id: ticketId });
}

export function trackForceClose(ticketId: string): void {
  gaEvent("job_force_closed", { ticket_id: ticketId });
  capture("job_force_closed", { ticket_id: ticketId });
}

export function trackCreditRechargeSubmitted(amountPaise: number): void {
  gaEvent("credit_recharge_submitted", { amount_paise: amountPaise });
  capture("credit_recharge_submitted", { amount_paise: amountPaise });
}

export function trackCreditRechargeConfirmed(amountPaise: number): void {
  gaEvent("credit_recharge_confirmed", { amount_paise: amountPaise });
  capture("credit_recharge_confirmed", { amount_paise: amountPaise });
}

/** PostHog only — a rules edit is an internal admin action, not a GA KPI. */
export function trackRuleUpdated(scope: string): void {
  capture("rule_updated", { scope });
}

export function trackUpiChangeApproved(technicianId: string): void {
  gaEvent("upi_change_approved", { technician_id: technicianId });
  capture("upi_change_approved", { technician_id: technicianId });
}
