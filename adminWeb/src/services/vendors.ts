/**
 * Vendor transport — live FastAPI, not the mock client.
 *
 * Every endpoint here is National-Head-and-above on the server, enforced twice:
 * a `vendors.view` / `vendors.edit` feature key AND a rank floor a per-company
 * feature override cannot lift. Hiding the nav entry is presentation only.
 */

import type {
  CreateVendorInput,
  IntakeChannelOption,
  UpdateVendorInput,
  Vendor,
  VendorOption,
} from "@/types/vendor";
import type { ListParams, Page } from "@/types/api";
import { apiDelete, apiGet, apiGetPage, apiPost, apiPut } from "./http";

export function listVendors(params: ListParams = {}): Promise<Page<Vendor>> {
  return apiGetPage<Vendor>("/vendors", params);
}

/**
 * Every selectable brand, unpaginated — the model form needs them all.
 *
 * Paused vendors are excluded by the server: this drives a picker for NEW
 * attributions, and a paused vendor is precisely one to stop attributing to.
 */
export function listVendorOptions(): Promise<VendorOption[]> {
  return apiGet<VendorOption[]>("/vendors/options");
}

/**
 * The three intake channels, and which of them can be picked today.
 *
 * Fetched rather than hard-coded so the "coming soon" reason lives in one place
 * and the form can never offer a channel the API would refuse — the same
 * reasoning as the icon catalogue on the product master.
 */
export function listIntakeChannels(): Promise<IntakeChannelOption[]> {
  return apiGet<IntakeChannelOption[]>("/vendors/channels");
}

export function getVendor(id: string): Promise<Vendor> {
  return apiGet<Vendor>(`/vendors/${id}`);
}

export function createVendor(input: CreateVendorInput): Promise<Vendor> {
  return apiPost<Vendor>("/vendors", input);
}

export function updateVendor({ id, ...body }: UpdateVendorInput): Promise<Vendor> {
  return apiPut<Vendor>(`/vendors/${id}`, body);
}

/**
 * Soft delete. The server refuses with a 409 naming the count when the vendor
 * still brands product models — the toaster surfaces that message as-is.
 */
export function deleteVendor(id: string): Promise<null> {
  return apiDelete<null>(`/vendors/${id}`);
}
