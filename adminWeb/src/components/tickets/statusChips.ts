import type { TicketStatus } from "@/types";

/**
 * The prototype's chip set — a curated subset, not all nine statuses.
 * Force-Closed, Cancelled and New are reachable by search, not by chip.
 *
 * `AI Review` is commented out with the rest of that slice: nothing writes the
 * status, so the chip could only ever filter the board down to nothing. It
 * stays in `TICKET_STATUSES` and in `StatusBadge` — those mirror the database's
 * CHECK constraint, and a status the schema allows must still render if one
 * ever arrives.
 */
export const STATUS_CHIPS: Array<TicketStatus | "All"> = [
  "All",
  "Slot Pending",
  "Assigned",
  "In Progress",
  "Awaiting Customer",
  // "AI Review",
  "Escalated",
  "Closed",
];
