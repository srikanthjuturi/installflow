/**
 * Ticket transport — live FastAPI, not the mock client.
 *
 * The list is territory-scoped on the server: an Area Manager sees only the
 * pincodes they cover, and a ticket id from outside their area returns 404
 * rather than 403. Nothing here has to know that; it is simply what arrives.
 */

import type { ListParams, Page } from "@/types/api";
import type {
  CorrectSerialInput,
  CreateTicketInput,
  Ticket,
  TicketDetail,
  TicketProof,
} from "@/types/ticket";
import { ApiError } from "./client";
import { apiGet, apiGetPage, apiPatch, apiPost } from "./http";

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

/**
 * One technician's tickets, as a normal ticket list.
 *
 * The id is merged into `filters`, which the transport flattens into the query
 * string — so this IS `listTickets` with one more filter, and it keeps every
 * capability the ticket screens have: search, status, sort and paging.
 *
 * No status filter of its own. A manager opening a technician mid-shift wants
 * to see what they are on right now as much as what they finished yesterday,
 * and hiding everything still open would make a busy technician read empty.
 *
 * Scoping is the server's: the id narrows a list that is already company- and
 * territory-scoped, so a technician outside the reader's area returns nothing
 * rather than leaking that they exist.
 */
export function listTechnicianTickets(
  technicianId: string,
  params: ListParams = {}
): Promise<Page<Ticket>> {
  return apiGetPage<Ticket>("/tickets", {
    ...params,
    filters: { ...params.filters, technicianId },
  });
}

/**
 * The profile screen's "Recent job history" — a short peek, not a workspace.
 *
 * Ordered by SLOT rather than by intake, because the table prints the day the
 * WORK happened: a ticket raised a week before its slot would otherwise sit at
 * the top of a list whose dates say it belongs further down.
 *
 * `limit` bounds the rows, but the response's `pagination.totalRecords` still
 * reports how many the technician has in total — which is what lets the profile
 * offer "See all N" without a second request.
 */
export function listTechnicianJobs(
  technicianId: string,
  limit = 5
): Promise<Page<Ticket>> {
  return listTechnicianTickets(technicianId, {
    limit,
    sortBy: "slotStart",
    sortDir: "desc",
  });
}

export function getTicket(id: string): Promise<TicketDetail> {
  return apiGet<TicketDetail>(`/tickets/${id}`);
}

/**
 * What the technician photographed on site.
 *
 * Who may read it is decided server-side by the same rule that scopes the
 * ticket: staff by territory, a vendor by ownership. The URLs come back signed
 * and expire in minutes, so this is never cached long — see `useTicketProof`.
 */
export function getTicketProof(id: string): Promise<TicketProof[]> {
  return apiGet<TicketProof[]>(`/tickets/${id}/proof`);
}

/**
 * Correct the EXPECTED serial — the number taken off the invoice.
 *
 * Whoever can see the ticket can fix it, and the vendor matters most: the
 * invoice is theirs, so a mistyped serial is theirs to correct. It never
 * touches what the technician read on site.
 */
export function correctTicketSerial({
  id,
  ...body
}: CorrectSerialInput): Promise<TicketDetail> {
  return apiPatch<TicketDetail>(`/tickets/${id}/serial`, body);
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
 *
 * When it does, it must refuse a ticket already in `TERMINAL_STATUSES` with a
 * 409 — `api/app/core/tickets.py`, the same set the detail screen hides its
 * actions on. The client guard is a courtesy, not the rule: it only knows what
 * the last read told it, and a colleague can close a ticket in the seconds
 * between that read and this call.
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

export interface AssignTechnicianInput {
  id: string;
  technicianId: string;
  /** For the toast and, later, the event's actor label. */
  technicianName: string;
}

/**
 * NOT IMPLEMENTED — deliberately, and loudly, for the same reason as
 * `forceCloseTicket`.
 *
 * This used to be the ESCALATION mock's `assignTechnician`, which held three
 * hardcoded rows keyed by ticket code. A real ticket's UUID was never one of
 * them, so pressing "Assign manually" on a ticket died as "Escalation <uuid>
 * not found" — an error about a thing the reader had not mentioned.
 *
 * Doing it for real is `POST /tickets/{id}/assign`: move the ticket to
 * Assigned, write the `assigned` event the daily cap is counted from, and
 * refuse a technician who does not cover the pincode or is already at cap.
 * `tickets.technician_id` and the `Assigned` status already exist;
 * `ticket_events.kind` has no `assigned` yet, so it needs a migration. Until
 * that lands this fails where it can be seen — an assignment that appeared to
 * work and moved nothing is the worse outcome.
 *
 * It refuses a ticket in `TERMINAL_STATUSES` with a 409 for the same reason
 * force-closure does, and there is a second one here: the daily cap counts
 * `Closed` jobs, so assigning a settled ticket would spend a technician's
 * bandwidth on a day whose work is already done.
 */
export function assignTechnician(input: AssignTechnicianInput): Promise<Ticket> {
  void input;
  return Promise.reject(
    new ApiError(
      "Assigning a technician isn't wired up yet — this ticket and the " +
        "shortlist beside it are real, but assignment still needs its own " +
        "slice. Nothing has been changed.",
      501
    )
  );
}
