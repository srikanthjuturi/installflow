import { ApiError, authedRequest } from '@/lib/api';
import type { CancellationReason, PenaltyBand } from '@/types/domain';

/**
 * Giving a job back — §7's other way into an escalation.
 *
 *   getCancellationPreview → GET  /jobs/:id/cancellation
 *   cancelJob              → POST /jobs/:id/cancel
 *
 * Both are real. The band used to be computed HERE, from `hoursToSlot` off the
 * device clock, which this file's own comment called the wrong place: a phone
 * with a wrong clock talked itself into a cheaper penalty. The server owns it
 * now, and owns two things the device never could — the company's own
 * configured amounts, and the technician's monthly cap.
 *
 * The preview and the charge read the same code, so the figure on the button
 * is the figure that is taken. It is a live figure rather than a quote,
 * though: the band tightens as the slot approaches, so a screen left open for
 * an hour can be shown one price and charged another. That is the honest
 * behaviour — the cost is what it is at the moment of cancelling — and the
 * response to the POST is the receipt.
 */

/** Mirrors `PenaltyBandOut` in the API. */
interface PenaltyBandDto {
  /** What will ACTUALLY be charged, which is not always the band's face
   *  value — a technician at their monthly cap is charged the remainder. */
  amountPaise: number;
  label: string;
  escalates: boolean;
}

function toBand(dto: PenaltyBandDto): PenaltyBand {
  return {
    amountPaise: dto.amountPaise,
    label: dto.label,
    escalates: dto.escalates,
  };
}

/**
 * What it would cost, before committing to it.
 *
 * A separate call from `cancelJob` because the technician must see the cost
 * BEFORE confirming — the approved screen prints it twice, in the banner and
 * on the button, so it cannot be tapped without having been read.
 */
export async function getCancellationPreview(id: string): Promise<PenaltyBand> {
  return toBand(await authedRequest<PenaltyBandDto>(`/jobs/${id}/cancellation`));
}

export interface CancelResult {
  penalty: PenaltyBand;
}

/**
 * A refusal that is not a failure: the job is no longer this technician's to
 * give up, because a manager re-assigned it or they tapped twice.
 *
 * Typed rather than surfaced as a generic error for the same reason
 * `JobTakenError` is: the screen has to say which happened, and "something
 * went wrong, try again" is the one message that is never true here — trying
 * again cannot make the job theirs.
 */
export class CancelRefusedError extends Error {
  readonly code = 'JOB_NOT_CANCELLABLE';

  constructor(message: string) {
    super(message);
    this.name = 'CancelRefusedError';
  }
}

export function isCancelRefused(error: unknown): error is CancelRefusedError {
  return error instanceof CancelRefusedError;
}

/**
 * Give the job back. The slot does not move; the band is charged.
 *
 * Answers with what was ACTUALLY taken, so the caller can report the real
 * figure rather than the one the preview quoted.
 */
export async function cancelJob(
  id: string,
  reason: CancellationReason,
): Promise<CancelResult> {
  try {
    const dto = await authedRequest<PenaltyBandDto>(`/jobs/${id}/cancel`, {
      method: 'POST',
      body: { reason },
    });
    return { penalty: toBand(dto) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new CancelRefusedError(error.message);
    }
    throw error;
  }
}
