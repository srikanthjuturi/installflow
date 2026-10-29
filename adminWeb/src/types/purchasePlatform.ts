/**
 * Purchase platforms (A7) — a short, company-scoped master: where a customer
 * bought the unit, when `Ticket.purchaseMode` is `"online"`.
 *
 * A vendor picks one on the raise-a-ticket form; an Admin can add a new one
 * inline from the same picker. Mirrors `PurchasePlatformOut` in
 * `api/app/features/purchase_platforms/schemas.py` — see that module and its
 * `router.py` for who may read and write it.
 */
export interface PurchasePlatform {
  id: string;
  name: string;
  /** A retired platform is never deleted — see `router.py`'s deactivate
   *  endpoint — so a ticket that already named one keeps reading its name
   *  through `Ticket.purchasePlatformName` even after this flips false. */
  isActive: boolean;
}

/** `POST /purchase-platforms`. Admin only; the server 409s a name that
 *  already exists (case-insensitive). */
export interface CreatePurchasePlatformInput {
  name: string;
}
