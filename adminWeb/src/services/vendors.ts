/**
 * Vendor transport — live FastAPI, not the mock client.
 *
 * Every endpoint here is National-Head-and-above on the server, enforced twice:
 * a `vendors.view` / `vendors.edit` feature key AND a rank floor a per-company
 * feature override cannot lift. Hiding the nav entry is presentation only.
 */

import type { GstinLookup } from "@/types/gst";
import type {
  CreatedVendor,
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

/**
 * What the GST registry says about a GSTIN — the vendor form's autofill.
 *
 * A POST because the API is one: it matches the provider, and it keeps a GSTIN
 * out of access logs and proxy caches. Every call spends a unit of a metered
 * subscription, so the hook that wraps this holds the answer for the session
 * rather than asking twice for the same number.
 *
 * Answers 200 for a GSTIN that is not registered and for a portal that could
 * not be reached — read `outcome`, do not rely on a rejection.
 */
export function lookupGstin(gstin: string): Promise<GstinLookup> {
  return apiPost<GstinLookup>("/vendors/gstin-lookup", { gstin });
}

export function getVendor(id: string): Promise<Vendor> {
  return apiGet<Vendor>(`/vendors/${id}`);
}

export function createVendor(input: CreateVendorInput): Promise<CreatedVendor> {
  return apiPost<CreatedVendor>("/vendors", input);
}

/**
 * Email this vendor's login a fresh temporary password, ending its sessions.
 *
 * Replaces the `password` field that used to ride on the update body — the
 * password is the server's to choose, so there is nothing to send.
 */
export function reissueVendorPassword(id: string): Promise<CreatedVendor> {
  return apiPost<CreatedVendor>(`/vendors/${id}/reissue-password`, {});
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

/**
 * Tell the server this vendor's portal just ran one address-search session.
 *
 * Google Places is called straight from the browser, so nothing else would ever
 * record it — without this call the console has no source for what a vendor is
 * costing. `sessionId` is the client's id for the session, and the server's
 * UNIQUE on it makes a repeat harmless.
 *
 * The vendor is NOT sent. It comes from the session, like everything else the
 * portal may call.
 */
export function recordAddressSearch(sessionId: string): Promise<null> {
  return apiPost<null>("/vendors/me/address-searches", { sessionId });
}
