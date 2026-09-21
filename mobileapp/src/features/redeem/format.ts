import type { PillTone } from '@/components/ui';
import type { RedemptionState } from '@/features/redeem/api/redeem';

// Dates ("12 Sep, 2:05 PM") live in `utils/date` with every other date, so
// they are worded in the app's language: `momentLabel`, `dayMonthLabel`.

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
