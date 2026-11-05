/**
 * Purchase platforms (A7) — live FastAPI, not the mock client.
 *
 * Reads are open to every signed-in company role — a vendor's own raise form
 * needs the list, same as a franchise principal's portal and staff's own
 * ticket detail — so unlike most masters there is deliberately no feature
 * key gating `GET /purchase-platforms`. Writes are Admin-only, enforced on
 * the server by a plain rank floor. See `api/app/features/purchase_platforms/
 * router.py`.
 */

import type {
  CreatePurchasePlatformInput,
  PurchasePlatform,
} from "@/types/purchasePlatform";
import { apiGet, apiPost, apiPut } from "./http";

/**
 * Every ACTIVE platform this company has, for the raise-a-ticket picker.
 *
 * `activeOnly=true` is what the form sends — a retired platform should not
 * be offered on a NEW ticket, though a ticket that already named one still
 * shows its name through `Ticket.purchasePlatformName` regardless.
 */
export function listPurchasePlatforms(): Promise<PurchasePlatform[]> {
  return apiGet<PurchasePlatform[]>("/purchase-platforms?activeOnly=true");
}

/**
 * Add a platform, from the form's inline "+ Add" — Admin only on the server.
 * **409** when the name already exists (case-insensitive); the toaster shows
 * the server's own sentence.
 */
export function createPurchasePlatform(
  input: CreatePurchasePlatformInput
): Promise<PurchasePlatform> {
  return apiPost<PurchasePlatform>("/purchase-platforms", input);
}

/**
 * Every platform this company has, active AND retired — the management
 * screen's own read. Unlike `listPurchasePlatforms` above (which the
 * raise-a-ticket picker calls with `activeOnly=true`), this omits the query
 * entirely so a paused platform stays visible here to be renamed or brought
 * back; `activeOnly` defaults to `false` on the server.
 */
export function listAllPurchasePlatforms(): Promise<PurchasePlatform[]> {
  return apiGet<PurchasePlatform[]>("/purchase-platforms");
}

/**
 * `PUT /purchase-platforms/{id}`. Admin only; both fields are optional and
 * independent — omitting one means "leave it alone", the same `PATCH`-shaped
 * doctrine `VendorUpdateRequest`'s clearable fields use. Rename sends `name`;
 * bringing a retired platform back (or pausing one without the dedicated
 * endpoint below) sends `isActive`.
 */
export interface UpdatePurchasePlatformInput {
  name?: string;
  isActive?: boolean;
}

export function updatePurchasePlatform({
  id,
  ...body
}: UpdatePurchasePlatformInput & { id: string }): Promise<PurchasePlatform> {
  return apiPut<PurchasePlatform>(`/purchase-platforms/${id}`, body);
}

/**
 * `POST /purchase-platforms/{id}/deactivate`. Admin only, and never a hard
 * delete — `tickets.purchase_platform_id` may already point at the row (see
 * `router.py`), so this is the only way out for a platform nobody wants
 * offered any more.
 */
export function deactivatePurchasePlatform(
  id: string
): Promise<PurchasePlatform> {
  return apiPost<PurchasePlatform>(`/purchase-platforms/${id}/deactivate`);
}
