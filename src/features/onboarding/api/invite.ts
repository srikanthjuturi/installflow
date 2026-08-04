import { delay } from '@/mocks/delay';
import { technician } from '@/mocks/db';

/**
 * What the invite deep link resolves to. Identity is decided by the ASM who
 * onboarded the technician, which is why these fields arrive read-only.
 */
export interface InviteDetails {
  fullName: string;
  mobile: string;
  technicianId: string;
  onboardedBy: string;
  region: string;
}

/**
 * UI phase: returns mock data.
 * Binding phase: replace the body with `GET /auth/invite/:token`. The signature
 * and the calling hook do not change.
 */
export async function fetchInvite(token: string): Promise<InviteDetails> {
  await delay(`invite:${token}`);

  return {
    fullName: technician.name,
    mobile: technician.phone,
    technicianId: technician.id,
    onboardedBy: technician.onboardedBy,
    region: technician.region,
  };
}
