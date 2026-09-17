import { ApiError, authedRequest } from '@/lib/api';

/**
 * A technician deleting their own account — the Google Play requirement for
 * an app where a user creates their own account. Same two-step shape as
 * adding a UPI ID (`features/payout/api/payout.ts`): a code to the
 * technician's own registered WhatsApp number, then the code. Verifying
 * deletes the account immediately — no manager approval, because unlike a
 * UPI change this is not money moving, it is the account ending.
 *
 *   sendDeletionCode → POST /technicians/me/deletion-request/code
 *   confirmDeletion  → POST /technicians/me/deletion-request
 */

/** Mirrors `OtpRequestResponse` / `PayoutCodeSent`. */
export interface DeletionCodeSent {
  sent: boolean;
  channel: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Development only — the server echoes the code when `OTP_DEV_ECHO` is on. */
  devCode: string | null;
}

/**
 * A refusal the next tap cannot fix — each says what to do instead. Switched
 * on the envelope's `code`, the pattern `payout.ts` uses.
 */
export type DeletionRefusal = 'TECHNICIAN_HAS_OPEN_JOBS' | 'NO_PHONE';

const REFUSALS: readonly DeletionRefusal[] = ['TECHNICIAN_HAS_OPEN_JOBS', 'NO_PHONE'];

export class DeletionRefusedError extends Error {
  constructor(
    readonly code: DeletionRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'DeletionRefusedError';
  }
}

/**
 * A wrong, expired or used code. Arrives as **400 `BAD_CODE`**, never 401 —
 * `authedRequest` reads a 401 as an expired session and would replay the
 * request, spending a second attempt on the same wrong digits.
 */
export class DeletionCodeError extends Error {
  readonly code = 'BAD_CODE';

  constructor(message: string) {
    super(message);
    this.name = 'DeletionCodeError';
  }
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'BAD_CODE') throw new DeletionCodeError(error.message);
      const refusal = REFUSALS.find((c) => c === error.code);
      if (refusal) throw new DeletionRefusedError(refusal, error.message);
    }
    throw error;
  }
}

/**
 * Step one: a code to the technician's own WhatsApp. 409
 * `TECHNICIAN_HAS_OPEN_JOBS` while a job is still open.
 */
export function sendDeletionCode(): Promise<DeletionCodeSent> {
  return call(() =>
    authedRequest<DeletionCodeSent>('/technicians/me/deletion-request/code', {
      method: 'POST',
    }),
  );
}

/** Step two: the code. The account is removed immediately. */
export function confirmDeletion(code: string): Promise<null> {
  return call(() =>
    authedRequest<null>('/technicians/me/deletion-request', {
      method: 'POST',
      body: { code },
    }),
  );
}
