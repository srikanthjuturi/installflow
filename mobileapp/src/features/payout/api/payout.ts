import { authedRequest } from '@/lib/api';

/** What the server says after a payout account is saved. */
export interface PayoutAccountResult {
  /** The VPA as now stored — trimmed and lowercased by the server. */
  upiId: string | null;
}

/**
 * Set or clear the technician's own payout account.
 *
 * `null` CLEARS it and is a real value, not an omission — the server tells the
 * two apart with `model_fields_set` and refuses a body that mentions neither —
 * so this always sends the key.
 *
 * Its own route rather than a field on `/technicians/me/availability`: they are
 * saved from different screens, and a request named for availability is the
 * wrong envelope for a payment credential. Neither can go through
 * `PUT /technicians/{id}`, which needs `technicians.edit` — a feature the
 * seeded technician role deliberately does not hold.
 */
export function setUpiId(upiId: string | null): Promise<PayoutAccountResult> {
  return authedRequest<PayoutAccountResult>('/technicians/me/payout-account', {
    method: 'PATCH',
    body: { upiId },
  });
}
