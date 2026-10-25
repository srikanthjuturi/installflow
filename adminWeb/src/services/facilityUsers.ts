/**
 * Facility users — the people who run a franchisee's parts store (Task 12 §4.8).
 *
 * One shape, two doors. The portal's franchisee admin (or a facility admin, for
 * operators) manages THEIR OWN franchisee's at `/franchise/facility-users`; the
 * company's Admin / National Head manage the HOME franchisee's at
 * `/spare-parts/home-facility-users` (see `services/parts.ts`). The calls and
 * the replies are identical, so `facilityUserSource(prefix)` builds either and
 * the table, the add dialog and the reissue dialog take a source instead of
 * knowing which door they are on.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  CreatedFacilityUser,
  CreateFacilityUserInput,
  FacilityUser,
} from "@/types/parts";
import { apiGetPage, apiPatch, apiPost } from "./http";

export interface FacilityUserSource {
  /** Part of every query key, so the two doors never share a cache entry. */
  key: string;
  list: (params?: ListParams) => Promise<Page<FacilityUser>>;
  create: (input: CreateFacilityUserInput) => Promise<CreatedFacilityUser>;
  setActive: (membershipId: string, isActive: boolean) => Promise<FacilityUser>;
  /** Revokes the person's sessions and emails a fresh temporary password. */
  reissuePassword: (membershipId: string) => Promise<CreatedFacilityUser>;
}

export function facilityUserSource(prefix: string): FacilityUserSource {
  return {
    key: prefix,
    list: (params = {}) => apiGetPage<FacilityUser>(prefix, params),
    create: (input) => apiPost<CreatedFacilityUser>(prefix, input),
    setActive: (membershipId, isActive) =>
      apiPatch<FacilityUser>(`${prefix}/${membershipId}`, { isActive }),
    reissuePassword: (membershipId) =>
      apiPost<CreatedFacilityUser>(`${prefix}/${membershipId}/reissue-password`),
  };
}

/** The franchise portal's own door — the session's franchisee, implied. */
export const franchiseFacilityUsers: FacilityUserSource = facilityUserSource(
  "/franchise/facility-users"
);
