/**
 * A vendor's own people — `/vendor/users`, not `/users`.
 *
 * The company's staff list is a different endpoint with a different key, which
 * a vendor holds neither of. The backend scopes every call three ways: the
 * tenant, the caller's own vendor, and the role.
 */

import { apiDelete, apiGetPage, apiPost, apiPut } from "./http";
import type { ListParams, Page } from "@/types/api";
import type {
  CreateVendorUserInput,
  UpdateVendorUserInput,
  VendorUser,
} from "@/types/vendorUser";

export function listVendorUsers(
  params: ListParams = {}
): Promise<Page<VendorUser>> {
  return apiGetPage<VendorUser>("/vendor/users", params);
}

export function createVendorUser(
  input: CreateVendorUserInput
): Promise<VendorUser> {
  return apiPost<VendorUser>("/vendor/users", input);
}

export function updateVendorUser(
  membershipId: string,
  input: UpdateVendorUserInput
): Promise<VendorUser> {
  return apiPut<VendorUser>(`/vendor/users/${membershipId}`, input);
}

export function deleteVendorUser(membershipId: string): Promise<null> {
  return apiDelete<null>(`/vendor/users/${membershipId}`);
}
