import { ApiError, authedRequest } from '@/lib/api';

/**
 * The technician's own UPI ID — add it once with a WhatsApp code, then ask a
 * manager to change it.
 *
 *   getPayoutAccount   → GET    /technicians/me/payout-account
 *   sendPayoutCode     → POST   /technicians/me/payout-account/code
 *   verifyPayoutAccount→ POST   /technicians/me/payout-account
 *   requestUpiChange   → POST   /technicians/me/payout-account/change-request
 *   withdrawUpiChange  → DELETE /technicians/me/payout-account/change-request
 *
 * **The code goes to the technician's own registered WhatsApp number.** Nothing
 * here names a destination — the server reads it off the account, so a client
 * cannot send the code somewhere else.
 *
 * **Once one is on file, only a manager changes it.** The technician proposes a
 * new UPI ID and name; the Area Manager for their area (else the Regional
 * Head, else a National Head, else an Admin) approves it with no code. It is
 * where money lands, and redirecting it is exactly what a borrowed phone would
 * try.
 *
 * Copy for the screen this feeds is net-new — the prototype drew this row as a
 * static `••4432` and has no payout screen at all.
 */

export type UpiChangeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface UpiChange {
  id: string;
  status: UpiChangeStatus;
  oldUpiId: string;
  oldUpiName: string | null;
  newUpiId: string;
  newUpiName: string;
  /** `area_manager` | `regional_head` | `national_head` | `admin`. */
  reviewerRole: string;
  /** "Area Manager" — for "Waiting for your Area Manager". */
  reviewerLabel: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
}

export interface PayoutAccount {
  upiId: string | null;
  upiName: string | null;
  /** The latest change request, whatever became of it. */
  change: UpiChange | null;
}

/** Mirrors `OtpRequestResponse`. */
export interface PayoutCodeSent {
  sent: boolean;
  channel: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Development only — the server echoes the code when `OTP_DEV_ECHO` is on. */
  devCode: string | null;
}

export function getPayoutAccount(): Promise<PayoutAccount> {
  return authedRequest<PayoutAccount>('/technicians/me/payout-account');
}

/**
 * A refusal the next tap cannot fix — each says what to do instead.
 * Switched on the envelope's `code`, the pattern `reschedule.ts` uses.
 */
export type PayoutRefusal =
  | 'UPI_ALREADY_SET'
  | 'NO_UPI_ID'
  | 'SAME_UPI_ID'
  | 'CHANGE_PENDING'
  | 'NO_PENDING_CHANGE'
  | 'NO_PHONE';

const REFUSALS: readonly PayoutRefusal[] = [
  'UPI_ALREADY_SET',
  'NO_UPI_ID',
  'SAME_UPI_ID',
  'CHANGE_PENDING',
  'NO_PENDING_CHANGE',
  'NO_PHONE',
];

export class PayoutRefusedError extends Error {
  constructor(
    readonly code: PayoutRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'PayoutRefusedError';
  }
}

/**
 * A wrong, expired or used code. Arrives as **400 `BAD_CODE`**, never 401 —
 * `authedRequest` reads a 401 as an expired session and would replay the
 * request, spending a second attempt on the same wrong digits.
 */
export class PayoutCodeError extends Error {
  readonly code = 'BAD_CODE';

  constructor(message: string) {
    super(message);
    this.name = 'PayoutCodeError';
  }
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'BAD_CODE') throw new PayoutCodeError(error.message);
      const refusal = REFUSALS.find((c) => c === error.code);
      if (refusal) throw new PayoutRefusedError(refusal, error.message);
    }
    throw error;
  }
}

/**
 * Step one of adding a UPI ID: a code to the technician's own WhatsApp. The
 * UPI ID and name go along so a malformed one is refused before a code is
 * spent. Asking again kills the previous code, and a 429 is the throttle.
 */
export function sendPayoutCode(upiId: string, upiName: string): Promise<PayoutCodeSent> {
  return call(() =>
    authedRequest<PayoutCodeSent>('/technicians/me/payout-account/code', {
      method: 'POST',
      body: { upiId, upiName },
    }),
  );
}

/** Step two: the code, and what to save. */
export function verifyPayoutAccount(
  upiId: string,
  upiName: string,
  code: string,
): Promise<PayoutAccount> {
  return call(() =>
    authedRequest<PayoutAccount>('/technicians/me/payout-account', {
      method: 'POST',
      body: { upiId, upiName, code },
    }),
  );
}

/** Propose a new UPI ID and name. A manager decides; there is no code. */
export function requestUpiChange(upiId: string, upiName: string): Promise<PayoutAccount> {
  return call(() =>
    authedRequest<PayoutAccount>('/technicians/me/payout-account/change-request', {
      method: 'POST',
      body: { upiId, upiName },
    }),
  );
}

/** Take back a change nobody has decided yet. */
export function withdrawUpiChange(): Promise<PayoutAccount> {
  return call(() =>
    authedRequest<PayoutAccount>('/technicians/me/payout-account/change-request', {
      method: 'DELETE',
    }),
  );
}
