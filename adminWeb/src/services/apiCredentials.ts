/**
 * API credentials and the call log — live FastAPI.
 *
 * All of it is guarded by the `integrations.manage` feature (Admin and National
 * Head) on the server; hiding the nav entry is presentation only. A vendor or
 * credential belonging to another company answers 404, exactly like one that
 * does not exist.
 *
 * The Client Secret comes back from `createApiCredential` and
 * `replaceApiCredential` and from nowhere else — never from the list.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  ApiCredential,
  ApiLogEntry,
  CreateApiCredentialInput,
  CreatedApiCredential,
} from "@/types/integration";
import { apiGet, apiGetPage, apiPost } from "./http";

/** The company's credentials, newest first; `vendorId` narrows to one vendor. */
export function listApiCredentials(vendorId?: string): Promise<ApiCredential[]> {
  const query = vendorId ? `?vendorId=${encodeURIComponent(vendorId)}` : "";
  return apiGet<ApiCredential[]>(`/api-credentials${query}`);
}

/**
 * Issue a credential for a vendor.
 *
 * 409 `API_CHANNEL_OFF` when the vendor does not have the API channel ticked,
 * 409 `VENDOR_INACTIVE` for a paused vendor.
 */
export function createApiCredential(
  input: CreateApiCredentialInput
): Promise<CreatedApiCredential> {
  return apiPost<CreatedApiCredential>("/api-credentials", input);
}

/**
 * Make a NEW credential for the same vendor. The old one keeps working until it
 * is revoked, so a CRM can switch over with no break.
 */
export function replaceApiCredential(id: string): Promise<CreatedApiCredential> {
  return apiPost<CreatedApiCredential>(`/api-credentials/${id}/replace`);
}

/** End a credential and every token issued from it. Idempotent. */
export function revokeApiCredential(id: string): Promise<ApiCredential> {
  return apiPost<ApiCredential>(`/api-credentials/${id}/revoke`);
}

/**
 * The call log, newest first, this company only.
 *
 * `filters` (see `ApiLogFilters`) rides in `ListParams.filters`, which the transport
 * flattens into the query string — so `vendorId`, `credentialId`, `endpoint`, `outcome`, `from` and
 * `to` reach `GET /api-logs` with no code here knowing the keys. Pagination is
 * the shared `page` / `limit`.
 */
export function listApiLogs(params: ListParams = {}): Promise<Page<ApiLogEntry>> {
  const filters = { ...params.filters };
  // The screen holds plain dates; the server takes instants. Both ends are
  // widened to the whole day in IST — the day an admin means — so choosing the
  // same day twice shows that day rather than an empty midnight-to-midnight.
  if (filters.from) filters.from = `${filters.from}T00:00:00+05:30`;
  if (filters.to) filters.to = `${filters.to}T23:59:59.999+05:30`;
  return apiGetPage<ApiLogEntry>("/api-logs", { ...params, filters });
}
