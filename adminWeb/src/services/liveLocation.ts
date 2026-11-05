/**
 * Technicians' live positions (Epic 4). The server scopes every answer to what
 * the caller may see; this file never sends a company id the caller was not
 * given - `companyId` is only ever set by the superadmin console (hard rule 0).
 */

import type { LiveLocation } from "@/types/liveLocation";
import { apiGet } from "./http";

/** One ticket's technician. `null` = job not active, or the phone is silent. */
export function getTicketLocation(ticketId: string): Promise<LiveLocation | null> {
  return apiGet<LiveLocation | null>(
    `/tickets/${encodeURIComponent(ticketId)}/technician-location`
  );
}

/** Every technician out on a job right now that THIS caller may see. */
export function listLiveLocations(): Promise<LiveLocation[]> {
  return apiGet<LiveLocation[]>("/tickets/live-locations");
}

/** Superadmin only; optionally one company. */
export function listAllLiveLocations(companyId?: string): Promise<LiveLocation[]> {
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  return apiGet<LiveLocation[]>(`/tickets/live-locations/all${qs}`);
}
