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

export interface CreateTicketInput {
  vendor: string;
  category: string;
  product: string;
  requestType: string;
  customer: string;
  mobile: string;
  pincode: string;
  expected: string;
  slaType: "24h" | "48h";
}

/**
 * Creating a ticket does NOT assign a technician. It fires the slot request
 * to the customer; only once they confirm does the ticket reach technicians.
 * The new ticket therefore starts at "Slot Pending" with no slot and no tech.
 */
export function createTicket(input: CreateTicketInput): Promise<Ticket> {
  return mockResponse(() => {
    const ticket: Ticket = {
      id: `INST-${241000 + TICKETS.length}`,
      vendor: input.vendor,
      category: input.category,
      product: input.product,
      customer: input.customer,
      mobile: input.mobile,
      city: "Pune",
      pincode: input.pincode,
      slaType: input.slaType,
      slot: "—",
      tech: "—",
      status: "Slot Pending",
      sla: "ok",
      created: "just now",
      expected: input.expected,
    };
    TICKETS.unshift(ticket);
    return ticket;
  });
}

export function getTicket(id: string): Promise<TicketDetail> {
  return mockResponse(() => {
    const ticket = TICKETS.find((t) => t.id === id);
    if (!ticket) notFound("Ticket", id);
    return { ...ticket, timeline: timelineFor(ticket) };
  });
}
