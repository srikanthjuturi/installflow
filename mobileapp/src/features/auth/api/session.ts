import { apiRequest, authedRequest } from '@/lib/api';
import type { TechnicianSession } from '@/types/domain';

/**
 * Technician sign-in: a phone number and a one-time code. There is no password
 * in this product, so there is nothing to forget and no reset flow.
 */

export interface OtpRequestResult {
  sent: boolean;
  /** 'whatsapp' | 'log'. 'log' means the server has no Meta credentials. */
  channel: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Development only — the server refuses to boot with this on in production. */
  devCode?: string | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  /**
   * Null when the account is not a technician, or its onboarding is
   * incomplete. Non-null is the "go straight to Home" signal.
   */
  technicianProfile: TechnicianSession | null;
}

export function requestOtp(phone: string): Promise<OtpRequestResult> {
  return apiRequest<OtpRequestResult>('/auth/otp/request', {
    method: 'POST',
    body: { phone },
  });
}

export function verifyOtp(phone: string, code: string): Promise<LoginResult> {
  return apiRequest<LoginResult>('/auth/otp/verify', {
    method: 'POST',
    body: { phone, code },
  });
}

/**
 * The signed-in technician's own profile.
 *
 * `/technicians/me` rather than `/auth/me`: the latter answers the console's
 * question (features, memberships, scope label) and carries none of the
 * name, coverage, cap or performance figures the Profile tab renders. It also
 * has no feature guard, because a technician is never granted
 * `technicians.view` and would be 403'd against their own record.
 */
export function fetchMyProfile(): Promise<TechnicianSession> {
  return authedRequest<TechnicianSession>('/technicians/me');
}
