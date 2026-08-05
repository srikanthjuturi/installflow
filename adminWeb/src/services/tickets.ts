import { mockResponse, notFound } from "./client";
import { TICKETS, timelineFor } from "./mocks/tickets";
import type { Ticket, TicketFilters, TimelineEvent } from "@/types";

/** Breach first — the whole point of the list is triage. */
const SLA_RANK = { breach: 0, warn: 1, ok: 2, done: 3 } as const;

export interface TicketDetail extends Ticket {
  timeline: TimelineEvent[];
}

export function listTickets(filters: TicketFilters = {}): Promise<Ticket[]> {
  return mockResponse(() => {
    const q = filters.search?.trim().toLowerCase() ?? "";
    return TICKETS.filter((t) => {
      if (filters.status && filters.status !== "All" && t.status !== filters.status) {
        return false;
      }
      if (!q) return true;
      return (
        t.id.toLowerCase().includes(q) ||
        t.customer.toLowerCase().includes(q) ||
        t.mobile.includes(q) ||
        t.pincode.includes(q)
      );
    }).sort((a, b) => SLA_RANK[a.sla] - SLA_RANK[b.sla]);
  });
}

export function getTicket(id: string): Promise<TicketDetail> {
  return mockResponse(() => {
    const ticket = TICKETS.find((t) => t.id === id);
    if (!ticket) notFound("Ticket", id);
    return { ...ticket, timeline: timelineFor(ticket) };
  });
}
