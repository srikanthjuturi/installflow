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

/** One already-uploaded file. A blob NAME, never a URL — see `uploads.ts`. */
export interface ForceCloseAttachment {
  blobName: string;
  fileName?: string;
}

export interface ForceCloseInput {
  id: string;
  reason: string;
  notes: string;
  attachments: ForceCloseAttachment[];
}

/**
 * End a job the customer never closed — §10's manager closure.
 *
 * The files are already in blob storage by the time this runs: the form
 * uploads each through `POST /uploads?kind=attachment` and sends back the
 * names. Same two-step as every other image in this console, and the reason
 * the API refuses a `data:` URL wherever one could appear.
 *
 * **409 `ALREADY_SETTLED`** when the ticket is already Closed, Force-Closed or
 * Cancelled. The detail screen hides its actions on the same set and this page
 * redirects on it, but neither is the rule: both only know what the last read
 * told them, and a colleague can settle a ticket in the seconds it takes to
 * fill the form in. The toaster shows the server's sentence.
 */
export function forceCloseTicket({
  id,
  ...body
}: ForceCloseInput): Promise<TicketDetail> {
  return apiPost<TicketDetail>(`/tickets/${id}/force-close`, body);
}

/** One attachment, as the detail screen reads it back. */
export interface TicketAttachment {
  ordinal: number;
  fileName: string | null;
  /** Signed and short-lived, minted per read. Null when it cannot be served. */
  url: string | null;
  uploadedAt: string;
}

/**
 * The evidence behind a force-closure.
 *
 * `jobs.view`, not `jobs.force_close` — whoever may see the ticket may see why
 * it was ended. Its own request rather than a field on the ticket because the
 * URLs expire: they are minted per read, exactly as proof images are.
 */
export function listTicketAttachments(id: string): Promise<TicketAttachment[]> {
  return apiGet<TicketAttachment[]>(`/tickets/${id}/attachments`);
}

export interface AssignTechnicianInput {
  id: string;
  technicianId: string;
  /** For the toast. The event's actor label is the MANAGER, server-side. */
  technicianName: string;
}

/**
 * Hand a ticket to a named technician — §7's last resort, after a bonus
 * re-notification has already failed to find anybody.
 *
 * `technicianName` is not sent: the server resolves the name itself for the
 * timeline, because a name a client supplied is a name a client could get
 * wrong. It travels on the input only so the caller can name them in the toast
 * without a second lookup.
 *
 * **409 says which kind of "no" it is** — `TICKET_NOT_ASSIGNABLE`, `NO_SLOT`,
 * `TECHNICIAN_SUSPENDED`, `TECHNICIAN_INELIGIBLE`, `DAILY_CAP_REACHED`,
 * `ALREADY_ASSIGNED` — and every one carries a sentence saying what to do
 * instead. The toaster shows that sentence; nothing here has to branch on the
 * code, and nothing should start to without a reason the message cannot serve.
 */
export function assignTechnician({
  id,
  technicianId,
}: AssignTechnicianInput): Promise<TicketDetail> {
  return apiPost<TicketDetail>(`/tickets/${id}/assign`, { technicianId });
}

export interface RecordNoShowInput {
  id: string;
  /** Optional, and worth asking for — see the API's own note on the field. */
  note?: string | null;
}

/**
 * Confirm that the technician never turned up, and charge them the band.
 *
 * The sweep that finds these deliberately charges nothing: a dead phone and a
 * deliberate no-show are indistinguishable in the data, and this is the most
 * expensive band there is. A person decides, and this is where they say so.
 *
 * Frees the ticket and moves it to `Escalated` — the slot has closed, so it
 * needs a new time rather than a new technician.
 *
 * **409 `NOT_A_NO_SHOW`** — the job started, was cancelled, or somebody moved
 * it while the manager was deciding. **409 `SLOT_STILL_OPEN`** — the window has
 * not closed, so they are late rather than absent. Both surface in the toaster.
 */
export function recordNoShow({
  id,
  note,
}: RecordNoShowInput): Promise<TicketDetail> {
  return apiPost<TicketDetail>(`/tickets/${id}/no-show`, { note: note ?? null });
}
