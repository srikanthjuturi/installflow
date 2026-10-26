import type { TicketStatus } from "@/types";

/**
 * The ticket board's Status dropdown — every status a ticket can actually be
 * in, in the order a ticket moves through them.
 *
 * It was a row of seven chips, the prototype's curated subset, which left New,
 * Force-Closed and Cancelled reachable only by search — and New is the status
 * of every ticket sitting in the pool. A dropdown has room for all of them, so
 * the subset went with the chips. "All" is not listed: the toolbar's select
 * supplies its own "Status: all" entry, and that is the default.
 *
 * Two members of `TICKET_STATUSES` are left out, for the same reason: nothing
 * in the API writes them, so the option could only ever filter the board down
 * to nothing.
 *
 * - `AI Review` is commented out with the rest of that slice.
 * - `Cancelled` — a technician's cancellation hands the job back to the pool,
 *   and a ticket leaves the live set only by closing or being force-closed.
 *
 * Both stay in `TICKET_STATUSES` and in `StatusBadge` — those mirror the
 * database's CHECK constraint, and a status the schema allows must still
 * render if one ever arrives. A `?status=Cancelled` link still filters.
 */
export const STATUS_FILTER: TicketStatus[] = [
  "Slot Pending",
  "New",
  "Assigned",
  "In Progress",
  "Awaiting Part",
  "Awaiting Customer",
  // "AI Review",
  "Escalated",
  "Closed",
  "Force-Closed",
  // "Cancelled",
];
