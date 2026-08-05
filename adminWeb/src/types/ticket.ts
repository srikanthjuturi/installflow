/** Ticket status. Nine values, exactly as the prototype defines them. */
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
 */
export type SlaState = "ok" | "warn" | "breach" | "done";

/** 24h or 48h from slot confirmation. */
export type SlaType = "24h" | "48h";

/** How the ticket entered the system. §4 of the requirement doc. */
export type IntakeChannel = "API" | "Excel" | "Manual";

export interface Ticket {
  id: string;
  vendor: string;
  category: string;
  product: string;
  /** Masked from technicians until they accept; ops always sees it. */
  customer: string;
  mobile: string;
  city: string;
  pincode: string;
  slaType: SlaType;
  /** The customer-confirmed slot. Locked to the ticket before any technician
   *  is notified — a technician accepts this time, never proposes one. */
  slot: string;
  /** `—` when nobody has accepted yet. */
  tech: string;
  status: TicketStatus;
  sla: SlaState;
  created: string;
  expected: string;
}

/** One entry in a ticket's audit trail. */
export interface TimelineEvent {
  t: string;
  ic: "intake" | "ok" | "msg" | "lock" | "bell" | "accept" | "progress";
  title: string;
  by: string;
  note: string;
}

export interface TicketFilters {
  search?: string;
  status?: TicketStatus | "All";
}
