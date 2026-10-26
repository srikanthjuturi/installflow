import { useMe } from '@/features/profile/hooks/useMe';
import { isEmployee } from '@/features/profile/technicianType';

/**
 * Whether the signed-in technician is paid by salary (Task 06).
 *
 * `useMe` is seeded from the persisted session and refetches
 * (`initialDataUpdatedAt: 0`), so a session saved before the type existed
 * briefly reads freelancer and corrects itself within one request. A manager
 * changing the type is picked up on the next `qk.me()` refetch.
 */
export function useIsEmployee(): boolean {
  return isEmployee(useMe().data);
}