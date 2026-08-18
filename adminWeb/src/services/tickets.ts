/**
 * Ticket transport — live FastAPI, not the mock client.
 *
 * The list is territory-scoped on the server: an Area Manager sees only the
 * pincodes they cover, and a ticket id from outside their area returns 404
 * rather than 403. Nothing here has to know that; it is simply what arrives.
 */

import type { ListParams, Page } from "@/types/api";
import type { CreateTicketInput, Ticket, TicketDetail } from "@/types/ticket";
import { ApiError } from "./client";
import { apiGet, apiGetPage, apiPost } from "./http";

/**
 * One page of tickets.
 *
 * Default order is SLA urgency — breach, warn, ok, done — because triage is
 * what the screen is for. `sortBy: "createdAt"` gives the chronological view.
 * The sort runs in SQL, so a page's total agrees with the rows on it.
 */
export function listTickets(params: ListParams = {}): Promise<Page<Ticket>> {
  return apiGetPage<Ticket>("/tickets", params);
}

export function getTicket(id: string): Promise<TicketDetail> {
  return apiGet<TicketDetail>(`/tickets/${id}`);
}

/**
 * Raise a ticket by hand — §4's third intake channel.
 *
 * A slot decides where it lands: with one the customer has already agreed a
 * time and the ticket is ready for technicians ("New"); without one it waits
 * ("Slot Pending"). The WhatsApp that tells the customer either way is a
 * later slice — nothing is sent yet.
 */
export function createTicket(input: CreateTicketInput): Promise<Ticket> {
  return apiPost<Ticket>("/tickets", input);
}

export interface ForceCloseInput {
  id: string;
  reason: string;
  notes: string;
  attachments: string[];
}

/**
 * NOT IMPLEMENTED — deliberately, and loudly.
 *
 * The mock flipped a status in memory and threw the reason, the notes and the
 * attachments away, while the screen promised they were "recorded for audit".
 * With the list now real, quietly keeping that would mean a force-close that
 * appears to work, changes nothing a colleague can see, and records none of the
 * justification it insisted on collecting.
 *
 * So it fails where it can be seen. Force-closure needs a status transition, a
 * real attachment upload and an audit row; it lands with the closure slice.
 */
export function forceCloseTicket(input: ForceCloseInput): Promise<Ticket> {
  void input;
  return Promise.reject(
    new ApiError(
      "Force-closing isn't wired up yet — the ticket list is real now, but " +
        "closure still needs its own slice. Nothing has been changed.",
      501
    )
  );
}
