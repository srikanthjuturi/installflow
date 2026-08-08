/**
 * Company users (memberships) — tenant-scoped service against the live backend.
 * Every call carries the caller's company via the bearer token; the backend
 * scopes and rank-checks. Hooks in `hooks/useCompanyUsers.ts` wrap these.
 */

import { apiDelete, apiGet, apiGetPage, apiPost, apiPut } from "./http";
import type { ListParams, Page } from "@/types/api";
import type {
  CompanyUser,
  CreateUserInput,
  RoleOption,
  UpdateUserInput,
} from "@/types/user";

export function listUsers(params: ListParams = {}): Promise<Page<CompanyUser>> {
  return apiGetPage<CompanyUser>("/users", params);
}

export function createUser(input: CreateUserInput): Promise<CompanyUser> {
  return apiPost<CompanyUser>("/users", input);
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
