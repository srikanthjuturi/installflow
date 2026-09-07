import { dayHeading, timeLabel } from '@/features/jobs/api/jobs';
import { toAcceptedJob, type JobDto } from '@/features/jobs/api/jobs';
import { ApiError, authedRequest } from '@/lib/api';
import type { Job } from '@/types/domain';

/**
 * Moving a job's agreed time, with the customer's consent.
 *
 *   getRescheduleSlots   → GET  /jobs/:id/reschedule/slots
 *   sendRescheduleCode   → POST /jobs/:id/reschedule/code
 *   rescheduleJob        → POST /jobs/:id/reschedule
 *
 * The alternative to cancelling, and the reason it exists: a customer who says
 * "come Thursday instead" used to leave the technician nothing but the cancel
 * screen, which charges the band and hands the job back to a pool that cannot
 * serve it either — the slot being re-offered is the one the customer refused.
 *
 * **The code goes to the CUSTOMER, not to this phone.** Nothing here names a
 * destination; the server reads it off the ticket. That is the whole gate —
 * a technician who could choose where the code went could send it to
 * themselves.
 *
 * Copy here is net-new rather than pulled from the prototype, which has no
 * reschedule screen at all — its 16 screens are login through profile and none
 * of them moves a time. Approved separately on 2026-09-07. See the note at the
 * head of `RescheduleJobScreen` for what that means for anything added later.
 */

/** Mirrors `SlotOptionOut` in the API: two instants, no rendered label. */
interface SlotOptionDto {
  slotStart: string;
  slotEnd: string;
}

export interface SlotOption {
  /** The ISO instant to post back. The server re-derives it either way. */
  startIso: string;
  /** `Today` or `Wed 9 Sep` — what the list groups under. */
  day: string;
  /** `2:00 PM–4:00 PM`. */
  time: string;
}

function toOption(dto: SlotOptionDto): SlotOption {
  return {
    startIso: dto.slotStart,
    day: dayHeading(dto.slotStart),
    time: `${timeLabel(dto.slotStart)}–${timeLabel(dto.slotEnd)}`,
  };
}

/**
 * Windows this job could move into, already filtered to what THIS technician
 * can serve — the days their cap is spent and the hours they are booked are
 * gone before the list arrives.
 *
 * An empty array is a real answer, not an error: it means their next two days
 * are full. The screen says so.
 */
export async function getRescheduleSlots(id: string): Promise<SlotOption[]> {
  const dtos = await authedRequest<SlotOptionDto[]>(`/jobs/${id}/reschedule/slots`);
  return dtos.map(toOption);
}

/** Mirrors `OtpRequestResponse`. */
export interface RescheduleCodeSent {
  sent: boolean;
  channel: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Development only — the server echoes the code when `OTP_DEV_ECHO` is on,
   *  because the customer's phone is not one you can read in dev. Never
   *  populated in production; startup refuses to boot with the flag set. */
  devCode: string | null;
}

/**
 * Ask the server to WhatsApp the customer a code agreeing to ONE window.
 *
 * `startIso` is not optional and is not a formality: the code is minted for
 * that window and verifies only for it. What the technician said out loud was
 * "can we do Thursday morning", so the customer's yes means Thursday morning —
 * a code bound to the ticket alone would let any time be booked with it.
 *
 * The practical consequence at the screen: **changing the window means asking
 * for a new code.** It is a different question.
 *
 * Two more things, both inherited from the shared OTP machinery:
 *
 *   * asking again KILLS the previous code, by phone number. So a technician
 *     who taps resend must tell the customer to ignore the first message;
 *   * the throttle is per phone number too, so a **429** is normal and its
 *     message says how long to wait.
 */
export async function sendRescheduleCode(
  id: string,
  startIso: string,
): Promise<RescheduleCodeSent> {
  try {
    return await authedRequest<RescheduleCodeSent>(`/jobs/${id}/reschedule/code`, {
      method: 'POST',
      body: { slotStart: startIso },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const refusal = REFUSAL_CODES.find((c) => c === error.code);
      if (refusal) throw new RescheduleRefusedError(refusal, error.message);
    }
    throw error;
  }
}

/**
 * A refusal that trying again cannot fix.
 *
 * Switches on the envelope's `code` rather than on the 409, which is
 * `accept.ts`'s pattern and the right one — `cancel.ts` hardcodes a single code
 * onto every 409 and would report the wrong reason the moment a second one
 * existed. Here there genuinely are two, and they lead to different actions:
 * one sends the technician back to the list, the other back to the job.
 */
export class RescheduleRefusedError extends Error {
  constructor(
    readonly code: 'JOB_NOT_RESCHEDULABLE' | 'SLOT_NO_LONGER_AVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'RescheduleRefusedError';
  }
}

export function isRescheduleRefused(error: unknown): error is RescheduleRefusedError {
  return error instanceof RescheduleRefusedError;
}

const REFUSAL_CODES = ['JOB_NOT_RESCHEDULABLE', 'SLOT_NO_LONGER_AVAILABLE'] as const;

/**
 * A wrong, expired, or already-used code. Distinct from a refusal above:
 * this one IS fixed by trying again, with a fresh code from the customer.
 *
 * It arrives as **400 `BAD_CODE`**, not the 401 the OTP machinery raises
 * internally, and that is deliberate on the server's side: `authedRequest`
 * reads any 401 as an expired access token, so it would refresh and REPLAY the
 * request — spending a second of the customer's five attempts on the same
 * wrong digits, and signing the technician out if the refresh failed.
 */
export class RescheduleCodeError extends Error {
  readonly code = 'BAD_CODE';

  constructor(message: string) {
    super(message);
    this.name = 'RescheduleCodeError';
  }
}

export function isRescheduleCodeError(error: unknown): error is RescheduleCodeError {
  return error instanceof RescheduleCodeError;
}

/**
 * Move the slot. Nothing is charged and the job stays this technician's.
 *
 * `startIso` is a claim: the server re-derives the offered list and matches
 * against it, so a window that closed while the screen was open comes back as
 * `SLOT_NO_LONGER_AVAILABLE` rather than being booked in the past.
 */
export async function rescheduleJob(
  id: string,
  startIso: string,
  code: string,
  note?: string,
): Promise<Job> {
  try {
    const dto = await authedRequest<JobDto>(`/jobs/${id}/reschedule`, {
      method: 'POST',
      body: { slotStart: startIso, code, ...(note ? { note } : {}) },
    });
    return toAcceptedJob(dto);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'BAD_CODE') throw new RescheduleCodeError(error.message);
      const refusal = REFUSAL_CODES.find((c) => c === error.code);
      if (refusal) throw new RescheduleRefusedError(refusal, error.message);
    }
    throw error;
  }
}
