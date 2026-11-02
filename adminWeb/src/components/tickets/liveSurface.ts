import type { TransactionSurface } from "@/types/transaction";

/**
 * Where each surface keeps the Live technicians page (Epic 4). The superadmin's
 * cannot be `/live-technicians`: that path is the company console's, behind a
 * different guard, and two top-level branches must not claim one URL (the same
 * reason Transactions is `/all-transactions` there).
 */
export const LIVE_TECHNICIANS_PATH: Record<TransactionSurface, string> = {
  superadmin: "/all-live-technicians",
  company: "/live-technicians",
  vendor: "/portal/live-technicians",
  franchise: "/franchise/live-technicians",
};
