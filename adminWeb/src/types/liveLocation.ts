/**
 * A technician's latest shared position (Epic 4). Mirrors `LiveLocationOut` in
 * `api/app/features/tickets/location_service.py`.
 *
 * Only the LATEST point exists - there is no trail, and none may be drawn.
 */
export const LIVE_TICKET_STATUSES = [
  "Assigned",
  "In Progress",
  "Awaiting Part",
] as const;

export type LiveTicketStatus = (typeof LIVE_TICKET_STATUSES)[number];

export interface LiveLocation {
  ticketId: string;
  ticketCode: string;
  status: LiveTicketStatus;
  technicianId: string;
  technicianName: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  recordedAt: string;
  receivedAt: string;
  ageSeconds: number;
  /** True when the server last heard from the phone more than 180 s ago. */
  stale: boolean;
  customerLatitude: number | null;
  customerLongitude: number | null;
  city: string | null;
  pincode: string | null;
  companyId: string;
}
