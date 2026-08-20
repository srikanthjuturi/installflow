/**
 * Technicians — live FastAPI, except the escalation shortlist.
 *
 * `listEligibleTechnicians` is the one thing still mocked here: it answers
 * "who could take this escalated ticket", which needs open assignments and free
 * bandwidth, and neither exists until the jobs slice does. It keeps the old
 * `EligibleTechnician` shape so the escalation screens are untouched.
 */

import { mockResponse } from "./client";
import { apiDelete, apiGetPage, apiGet, apiPost, apiPut } from "./http";
import { TECHNICIANS } from "./mocks/technicians";
import type { ListParams, Page } from "@/types/api";
import type { EligibleTechnician } from "@/types";
import type {
  CreateTechnicianInput,
  InviteTechnicianInput,
  Technician,
  TechnicianInvite,
  TechnicianRow,
  UpdateTechnicianInput,
} from "@/types/technician";

/**
 * One page of the Technicians screen — registered technicians AND open invites.
 *
 * The union happens on the server, so the page size is a real page size. Two
 * endpoints stitched together in the browser would give neither list's.
 */
export function listTechnicians(
  params: ListParams = {}
): Promise<Page<TechnicianRow>> {
  return apiGetPage<TechnicianRow>("/technicians", params);
}

export function getTechnician(id: string): Promise<Technician> {
  return apiGet<Technician>(`/technicians/${id}`);
}

export function createTechnician(
  input: CreateTechnicianInput
): Promise<Technician> {
  return apiPost<Technician>("/technicians", input);
}

export function updateTechnician({
  id,
  ...body
}: UpdateTechnicianInput): Promise<Technician> {
  return apiPut<Technician>(`/technicians/${id}`, body);
}

export function deleteTechnician(id: string): Promise<null> {
  return apiDelete<null>(`/technicians/${id}`);
}

/* --------------------------------------------------------------- invites */

export function inviteTechnician(
  input: InviteTechnicianInput
): Promise<TechnicianInvite> {
  return apiPost<TechnicianInvite>("/technicians/invites", input);
}

export function resendInvite(id: string): Promise<TechnicianInvite> {
  return apiPost<TechnicianInvite>(`/technicians/invites/${id}/resend`);
}

export function cancelInvite(id: string): Promise<null> {
  return apiDelete<null>(`/technicians/invites/${id}`);
}

/* ------------------------------------------------------- escalation only */

/**
 * Eligible for a given escalated ticket: active, with bandwidth left, and
 * certified for the category.
 *
 * Deliberately NOT paginated. This is the shortlist for one escalated ticket,
 * read inside a card while a manager decides who to hand it to — a page 2 the
 * reader has to go and find would hide candidates at the moment of the choice.
 *
 * Still mock-backed: "has bandwidth left" needs a jobs table that does not
 * exist yet, so answering it against the API would mean inventing the number.
 */
export function listEligibleTechnicians(
  category?: string
): Promise<EligibleTechnician[]> {
  return mockResponse(() =>
    TECHNICIANS.filter(
      (t) =>
        t.status === "Active" &&
        t.bwUsed < t.bwTotal &&
        (!category || t.cats.includes(category))
    )
  );
}

/* ------------------------------------------------- one ticket's shortlist */

/**
 * Who could take THIS ticket. Live, unlike `listEligibleTechnicians` above.
 *
 * The server already filters on both halves of the question — `GET
 * /technicians` takes `subcategoryId` and `pincode` — so this is the real
 * shortlist rather than the escalation mock's invented one: registered, active,
 * certified for the ticket's subcategory, covering its pincode, and inside the
 * reader's own territory, because the list is scoped there already.
 *
 * It deliberately does NOT answer "has bandwidth left today". That counts open
 * assignments, and there are none to count until the jobs slice exists — which
 * is why the screen shows the daily CAP, which is real, and claims nothing
 * about today's load, which is not.
 *
 * One page of 100, the API's ceiling, and unpaginated on screen: this is the
 * shortlist for one subcategory in one pincode, read while a manager decides.
 * A candidate on page 2 is a candidate nobody considers.
 */
export function listCandidateTechnicians(input: {
  subcategoryId: string;
  pincode: string;
}): Promise<Technician[]> {
  return apiGetPage<TechnicianRow>("/technicians", {
    limit: 100,
    filters: {
      view: "registered",
      status: "active",
      subcategoryId: input.subcategoryId,
      pincode: input.pincode,
    },
  }).then(({ rows }) => rows.filter((row): row is Technician => row.registered));
}
