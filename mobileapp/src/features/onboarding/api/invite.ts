import { apiRequest } from '@/lib/api';
import type { LoginResult } from '@/features/auth/api/session';

/**
 * Self-registration from an invite link. Every call here is unauthenticated —
 * the invite token IS the credential until the OTP is verified.
 */

export interface InviteSubcategory {
  id: string;
  name: string;
  iconKey: string;
  isActive: boolean;
}

export interface InviteCategory {
  id: string;
  name: string;
  iconKey: string;
  subcategories: InviteSubcategory[];
}

export interface InviteDetails {
  /** E.164. The number the invite was sent to, and the only identity so far. */
  phone: string;
  companyName: string;
  regionName: string;
  invitedByName: string | null;
  expiresAt: string;
  dailyJobCap: number;
  /** Bundled so the coverage screen needs one call, not two, on a field connection. */
  categories: InviteCategory[];
  /**
   * When an area manager sent the invite, the only pincodes this technician may
   * claim. Null means unrestricted — so the screen offers free entry instead of
   * a picker.
   */
  allowedPincodes: string[] | null;
}

export interface RegistrationToken {
  registrationToken: string;
  expiresAt: string;
}

export interface SelfRegisterBody {
  fullName: string;
  profileImageUrl?: string | null;
  subcategoryIds: string[];
  pincodes: string[];
  dailyJobCap?: number | null;
}

export function resolveInvite(token: string): Promise<InviteDetails> {
  return apiRequest<InviteDetails>(`/onboarding/invites/${token}`);
}

export function requestInviteOtp(token: string) {
  return apiRequest<{
    sent: boolean;
    channel: string;
    expiresInSeconds: number;
    resendInSeconds: number;
    devCode?: string | null;
  }>(`/onboarding/invites/${token}/otp`, { method: 'POST' });
}

export function verifyInviteOtp(
  token: string,
  code: string,
): Promise<RegistrationToken> {
  return apiRequest<RegistrationToken>(`/onboarding/invites/${token}/otp/verify`, {
    method: 'POST',
    body: { code },
  });
}

/**
 * The one write in the whole flow.
 *
 * Everything the technician typed is held on the device until this call, so an
 * abandoned registration leaves no partial record and an intercepted link
 * writes nothing. `registrationToken` proves they hold the invited phone.
 */
export function submitRegistration(
  token: string,
  registrationToken: string,
  body: SelfRegisterBody,
): Promise<LoginResult> {
  return apiRequest<LoginResult>(`/onboarding/invites/${token}/register`, {
    method: 'POST',
    body,
    token: registrationToken,
  });
}
