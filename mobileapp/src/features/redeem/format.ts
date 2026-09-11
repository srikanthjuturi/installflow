import type { PillTone } from '@/components/ui';
import type { RedemptionState } from '@/features/redeem/api/redeem';

const LOCALE = 'en-IN';
const TZ = 'Asia/Kolkata';

/** `12 Sep, 2:05 PM`, in IST — the moment somebody said something. */
export function momentLabel(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: TZ });
  const time = at
    .toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ })
    .toUpperCase();
  return `${day}, ${time}`;
}

/** `12 Sep` — a list row's date. */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  });
}

/**
 * The pill for each state. Approved with the plan on 2026-09-11 — the
 * prototype has no redeem screen, so none of these come from it.
 *
 * "Paid — confirm" is the one that asks for something: the payer says the
 * money went, and only the technician can say it arrived.
 */
export const STATE_PILL: Record<RedemptionState, { label: string; tone: PillTone }> = {
  to_pay: { label: 'Waiting for payment', tone: 'secondary' },
  awaiting: { label: 'Paid — confirm', tone: 'primary' },
  settled: { label: 'Received', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
};
