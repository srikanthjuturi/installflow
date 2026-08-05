import type { TicketStatus } from "@/types";

/**
 * The prototype's chip set — a curated subset, not all nine statuses.
 * Force-Closed, Cancelled and New are reachable by search, not by chip.
 */
export const STATUS_CHIPS: Array<TicketStatus | "All"> = [
  "All",
  "Slot Pending",
  "Assigned",
  "In Progress",
  "AI Review",
  "Escalated",
  "Closed",
];
