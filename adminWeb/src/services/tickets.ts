import {
  ApiError,
  matches,
  mockPage,
  mockResponse,
  notFound,
  sortRows,
} from "./client";
import { TICKETS, timelineFor } from "./mocks/tickets";
import type { ListParams, Page } from "@/types/api";
import type { Ticket, TimelineEvent } from "@/types";

/** Breach first — the whole point of the list is triage. */
const SLA_RANK = { breach: 0, warn: 1, ok: 2, done: 3 } as const;

export interface TicketDetail extends Ticket {
  timeline: TimelineEvent[];
}

/**
 * The sort keys the list endpoint accepts.
 *
 * Keyed by the TicketTable column id, so `sortBy` round-trips: the header the
 * user clicked is the key that goes out and comes back in the URL.
 */
const TICKET_SORTS: Record<string, (t: Ticket) => string | number | null> = {
  ticket: (t) => t.id,
  customer: (t) => t.customer,
  category: (t) => t.category,
  sla: (t) => t.slaType,
  slot: (t) => t.slot,
  tech: (t) => t.tech,
  status: (t) => t.status,
  // The cell shows a word; the sort runs on the urgency rank behind it.
  slaState: (t) => SLA_RANK[t.sla],
};

/** Triage order, and what the list falls back to when nothing is asked for. */
const DEFAULT_SORT_BY = "slaState";

/**
 * Searching, filtering, sorting and slicing all happen HERE, because they all
 * happen on the server — the browser only ever sees one page.
 */
export function listTickets(params: ListParams = {}): Promise<Page<Ticket>> {
  return mockPage(() => {
    const status = params.filters?.status;
    const rows = TICKETS.filter((t) => {
      if (status && status !== "All" && t.status !== status) return false;
      return matches(t, ["id", "customer", "mobile", "pincode"], params.search);
    });
    return sortRows(
      rows,
      params.sortBy ?? DEFAULT_SORT_BY,
      params.sortDir ?? "asc",
      TICKET_SORTS
    );
  }, params);
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

export interface ForceCloseInput {
  id: string;
  reason: string;
  notes: string;
  attachments: string[];
}

/**
 * Manager closure (§10). Only available once the customer wait period has
 * elapsed, and only WITH supporting documents — the attachment list is not
 * optional, and who closed it, when and on what basis is recorded for audit.
 */
export function forceCloseTicket(input: ForceCloseInput): Promise<Ticket> {
  return mockResponse(() => {
    const ticket = TICKETS.find((t) => t.id === input.id);
    if (!ticket) notFound("Ticket", input.id);
    if (input.attachments.length === 0) {
      throw new ApiError(
        "Supporting attachments are required to force-close",
        422
      );
    }
    ticket.status = "Force-Closed";
    ticket.sla = "done";
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
