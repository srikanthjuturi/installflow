/**
 * Company users (memberships) — tenant-scoped service against the live backend.
 * Every call carries the caller's company via the bearer token; the backend
 * scopes and rank-checks. Hooks in `hooks/useCompanyUsers.ts` wrap these.
 */

import { apiDelete, apiGet, apiGetPage, apiPost, apiPut } from "./http";
import type { ListParams, Page } from "@/types/api";
import type {
  CompanyUser,
  CreatedCompanyUser,
  CreateUserInput,
  Region,
  RoleOption,
  UpdateUserInput,
} from "@/types/user";

export function listUsers(params: ListParams = {}): Promise<Page<CompanyUser>> {
  return apiGetPage<CompanyUser>("/users", params);
}

/**
 * Create a member. The server generates the temporary password and emails it,
 * so there is none to send — read `emailStatus` on the reply to find out
 * whether it went, and `temporaryPassword` when it did not.
 */
export function createUser(
  input: CreateUserInput
): Promise<CreatedCompanyUser> {
  return apiPost<CreatedCompanyUser>("/users", input);
}

/**
 * Email this member a fresh temporary password, ending every session they hold.
 *
 * The way back in for somebody who never received the first one. Takes no body:
 * the password is the server's to choose.
 */
export function reissueUserPassword(
  membershipId: string
): Promise<CreatedCompanyUser> {
  return apiPost<CreatedCompanyUser>(
    `/users/${membershipId}/reissue-password`,
    {}
  );
}

export function updateUser(
  membershipId: string,
  input: UpdateUserInput
): Promise<CompanyUser> {
  return apiPut<CompanyUser>(`/users/${membershipId}`, input);
}

export function deleteUser(membershipId: string): Promise<null> {
  return apiDelete<null>(`/users/${membershipId}`);
}

/** The role catalog (non-superadmin), with ranks. Stable — cache aggressively. */
export function listRoles(): Promise<RoleOption[]> {
  return apiGet<RoleOption[]>("/roles");
}

/** The five regions of India. Reference data — cache aggressively. */
export function listRegions(): Promise<Region[]> {
  return apiGet<Region[]>("/regions");
}
