import type { ServiceType } from "./product";

/** Ticket status. Nine values, exactly as the prototype defines them.
 *
 *  Two are worth spelling out, because the names do not carry their meaning:
 *
 *    Slot Pending  raised, but nobody has agreed a time. No technician has been
 *                  told it exists.
 *    New           the slot is locked and the ticket is in the pool. Eligible
 *                  technicians can see it; none has accepted.
 *
 *  There is no state between New and Assigned — Assigned already means somebody
 *  took it.
 */
export const TICKET_STATUSES = [
  "New",
  "Slot Pending",
  "Assigned",
  "In Progress",
  "AI Review",
  "Escalated",
  "Closed",
  "Force-Closed",
  "Cancelled",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * SLA state. `done` means the window closed with the job complete — it is a
 * terminal state, not a healthy one, so it never sorts with `ok`.
 *
 * Derived by the API on every read, never stored: it changes with the clock,
 * and a stored copy would be wrong the moment nobody looked at it.
 */
export type SlaState = "ok" | "warn" | "breach" | "done";

/**
 * Hours. **The slot must START within this long of the ticket being raised.**
 *
 * Mirrors SERVICE_LEVEL_HOURS in `api/app/core/tickets.py`. The anchor was a
 * real decision: the requirement doc has the customer picking "a slot within
 * the ticket's SLA window", the prototype said "24 hours from slot
 * confirmation", and those give opposite answers to "can a ticket go late while
 * the customer is silent?". It can — silence burns the window, which is what
 * makes "Slot not confirmed > 6h" a number worth showing.
 */
export const SERVICE_LEVELS = [12, 24, 36, 48] as const;
export type ServiceLevelHours = (typeof SERVICE_LEVELS)[number];

export interface Ticket {
  id: string;
  /** `INST-240912`. What ops quote on the phone. */
  code: string;

  /* Everything below is stored by ID and resolved to a name by the API. The
     mock stored names, so renaming anything in the product master silently
     orphaned every ticket that referenced it. */
  vendorId: string;
  vendorName: string;
  subcategoryId: string;
  /** The parent category — the level the console groups the column by. */
  categoryName: string;
  subcategoryName: string;
  modelId: string;
  modelName: string;

  /** Constrained to what the chosen model declares it supports. */
  serviceType: ServiceType;
  /** The customer's problem. Present for Tech Visit and Service, null otherwise. */
  description: string | null;
  /**
   * The EXPECTED serial, off the invoice — not the one the technician
   * photographs on site. A mismatch between the two is what AI review is for.
   */
  serialNumber: string | null;

  /** Masked from technicians until they accept; ops always sees it. */
  customerName: string;
  customerPhone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;

  /** ISO date. */
  expectedDate: string;
  serviceLevelHours: ServiceLevelHours;
  /** The customer-confirmed slot, or null while it is still Slot Pending. */
  slotStart: string | null;
  slotEnd: string | null;
  slaDueAt: string;
  slaState: SlaState;

  status: TicketStatus;
  /** Null until a technician accepts — first-accept-wins. */
  technicianId: string | null;
  technicianName: string | null;

  /** Delivery of the "pick a time" message. `not_needed` when ops set the slot. */
  slotRequestStatus: "not_needed" | "pending" | "sent" | "failed";
  /** WhatsApp's own words when it refused, so ops can act rather than guess. */
  slotRequestError: string | null;
  /**
   * When the CUSTOMER picked. Null when ops entered the slot themselves —
   * which is how the console tells "they chose this" from "we did".
   */
  slotConfirmedAt: string | null;
  /**
   * The scheduling link, so ops can copy it out when WhatsApp refuses and read
   * it down the phone. Present only while the slot is still the customer's to
   * pick; it disappears the moment it is used.
   */
  slotLink: string | null;

  createdAt: string;
}

/**
 * One entry in a ticket's audit trail.
 *
 * Built by the API from stored facts only. The mock derived a seven-event trail
 * from `status` alone — "Notified 6 eligible technicians" for a ticket nothing
 * had notified — so this list is currently short, and honest. It grows as the
 * slices that cause the events land.
 */
export interface TimelineEvent {
  at: string;
  kind: "intake" | "ok" | "msg" | "lock" | "bell" | "accept" | "progress";
  title: string;
  by: string;
  note: string;
}

export interface TicketDetail extends Ticket {
  timeline: TimelineEvent[];
}

export interface CreateTicketInput {
  vendorId: string;
  subcategoryId: string;
  modelId: string;
  serviceType: ServiceType;
  description?: string | null;
  serialNumber?: string | null;
  customerName: string;
  customerPhone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  expectedDate: string;
  serviceLevelHours: ServiceLevelHours;
  slotStart?: string | null;
  slotEnd?: string | null;
}
