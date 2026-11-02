import { surfaceOf, type Surface } from "@/lib/surface";
import type { TransactionSurface } from "@/types/transaction";

/**
 * Which of the four Transactions surfaces a session is on. The staff console
 * is `company` here (only Admin / National Head reach it - the route is gated
 * on `finance.transactions`), the shell names are `surfaceOf`'s.
 */
const MAP: Record<Surface, TransactionSurface> = {
  superadmin: "superadmin",
  ops: "company",
  vendor: "vendor",
  franchise: "franchise",
};

export function transactionSurfaceOf(flags: {
  superadmin: boolean;
  franchise: boolean;
  portal: boolean;
}): TransactionSurface {
  return MAP[surfaceOf(flags)];
}

/**
 * Where each surface keeps the Transactions screen. The superadmin's cannot be
 * `/transactions`: that path is the company console's, behind a different
 * guard, and two branches of the route table must not claim one URL.
 */
export const TRANSACTIONS_PATH: Record<TransactionSurface, string> = {
  superadmin: "/all-transactions",
  company: "/transactions",
  vendor: "/portal/documents",
  franchise: "/franchise/documents",
};

/** A ticket's page on each surface. The superadmin has none (null). */
export function ticketPathFor(
  surface: TransactionSurface,
  ticketId: string
): string | null {
  switch (surface) {
    case "company":
      return `/tickets/${ticketId}`;
    case "vendor":
      return `/portal/tickets/${ticketId}`;
    case "franchise":
      return `/franchise/tickets/${ticketId}`;
    case "superadmin":
      return null;
  }
}
