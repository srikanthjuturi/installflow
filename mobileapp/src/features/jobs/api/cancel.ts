import { jobs } from '@/mocks/db';
import { delay } from '@/mocks/delay';
import type { CancellationReason, PenaltyBand } from '@/types/domain';

/**
 * Penalty bands, from the approved prototype. The requirements doc left the
 * exact scale open (Q5); these are the numbers the client has already seen.
 *
 * Deliberately a separate call from `cancelJob`: the technician must see the
 * cost BEFORE confirming, and the band depends on how close to the slot the
 * cancellation actually lands — which is server time, not device time. A phone
 * with a wrong clock must never be able to talk itself into a cheaper penalty.
 */
export async function getCancellationPreview(id: string): Promise<PenaltyBand> {
  await delay(`cancel-preview:${id}`, 200, 500);

  const job = jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Job ${id} not found`);

  return resolveBand(job.hoursToSlot);
}

export function resolveBand(hoursToSlot: number): PenaltyBand {
  if (hoursToSlot < 4) {
    return {
      amountPaise: 25000,
      label: 'Within 4 hours of slot',
      escalates: true,
    };
  }
  if (hoursToSlot < 8) {
    return { amountPaise: 15000, label: '4–8 hours before slot', escalates: false };
  }
  return { amountPaise: 8000, label: 'More than 8 hours before slot', escalates: false };
}

export interface CancelResult {
  penalty: PenaltyBand;
}

/** Binding phase: `POST /jobs/:id/cancel` with `{ reasonCode }`. */
export async function cancelJob(
  id: string,
  reason: CancellationReason,
): Promise<CancelResult> {
  await delay(`cancel:${id}`, 400, 800);

  const job = jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Job ${id} not found`);

  void reason;
  const penalty = resolveBand(job.hoursToSlot);
  job.status = 'pool';

  return { penalty };
}
