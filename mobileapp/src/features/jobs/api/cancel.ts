import { getJob } from '@/features/jobs/api/jobs';
import type { CancellationReason, PenaltyBand } from '@/types/domain';

/**
 * Penalty bands, from the approved prototype. The requirements doc left the
 * exact scale open (Q5); these are the numbers the client has already seen.
 *
 * Deliberately a separate call from `cancelJob`: the technician must see the
 * cost BEFORE confirming, and the band depends on how close to the slot the
 * cancellation actually lands.
 *
 * ⚠ Still computed on the DEVICE, which is the wrong place. `hoursToSlot` is
 * derived from the phone's clock, so a wrong clock talks itself into a cheaper
 * penalty. It reads the real job now rather than a mock row, so the SLOT is
 * true — but the band must move server-side with the rest of the cancel slice,
 * and until it does the entry point to this screen stays hidden on Job detail.
 */
export async function getCancellationPreview(id: string): Promise<PenaltyBand> {
  const job = await getJob(id);
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

/**
 * Not implemented, and deliberately loud about it.
 *
 * There is no `POST /jobs/:id/cancel`. The previous version mutated a seeded
 * array — it returned a penalty, flipped a mock row back to `pool`, and looked
 * exactly like a working cancellation while the real ticket stayed assigned.
 * That is the worst possible failure for this particular action: a technician
 * would believe they were released from a customer commitment they still hold.
 *
 * Throwing means the screen shows its error state instead. The Job detail entry
 * point is hidden until the slice is real, so this should be unreachable.
 */
export async function cancelJob(
  id: string,
  reason: CancellationReason,
): Promise<CancelResult> {
  void id;
  void reason;
  throw new Error('Cancelling a job is not available yet.');
}
