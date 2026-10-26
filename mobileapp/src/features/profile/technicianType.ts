// src/features/profile/technicianType.ts — pure
import type { TechnicianSession } from '@/types/domain';

export const TECHNICIAN_TYPE_EMPLOYEE = 'employee';

/**
 * Absent, null, `freelancer` or any word this build does not know → false
 * (today's behaviour). Safe in that direction: the server refuses an
 * employee's redemption anyway (409).
 */
export function isEmployee(
  me: Pick<TechnicianSession, 'technicianType'> | null | undefined,
): boolean {
  return me?.technicianType === TECHNICIAN_TYPE_EMPLOYEE;
}