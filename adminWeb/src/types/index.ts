export * from "./ticket";
export * from "./dashboard";

/**
 * Management hierarchy, widest scope first. Ops Staff do intake only.
 * Mirrors the backend's numeric codes 1–5 — see API_ROLE.
 */
export type Role = "Admin" | "NH" | "RSH" | "ASM" | "Ops Staff";

/*
 * `EligibleTechnician` and `Escalation` used to live here.
 *
 * Both were display shapes for a mock — `slot: "Aug 5, 09:00–11:00"`,
 * `left: "2h 40m"`, `pool: 1800` — and both are gone because their subjects
 * turned out to be things that already had types. An escalation IS a `Ticket`
 * (`types/ticket.ts`), and a candidate for one IS a `Technician`
 * (`types/technician.ts`), which is why the queue could never be opened from a
 * real ticket: the mock's rows were keyed by ticket CODE and a UUID was never
 * one of them.
 *
 * The pre-formatted strings went with them. `formatSlot` and `slotCountdown` in
 * `utils/datetime.ts` render the instants the API sends, in the reader's own
 * clock — a countdown built server-side is already wrong when it arrives.
 */

export interface AiFlag {
  id: string;
  customer: string;
  product: string;
  expectedSerial: string;
  detectedSerial: string;
  /** 0–1. Below the configured threshold routes to ASM review. */
  conf: number;
  flag: string;
  tech: string;
  when: string;
}

/**
 * One movement of the penalty pool.
 *
 * The mock carried a display shape — `date: "Aug 4"`, `type: "Penalty"`, and a
 * signed `amt` in rupees. All three are gone for the same reason the
 * escalation queue's were: the server sends instants, a value, and paise, and
 * a string built server-side is already somebody's opinion about the reader's
 * clock and currency formatting.
 *
 * **No sign is stored.** A penalty and a bonus point in opposite directions,
 * but which direction depends on who is looking: to the POOL a penalty is
 * money in, to the TECHNICIAN it is a debit. The API's own note explains it;
 * here it means the table applies the technician's sign where it prints one,
 * out loud, rather than trusting a sign that means two things.
 */
export interface LedgerEntry {
  id: string;
  /** ISO instant. */
  at: string;
  kind: "penalty" | "bonus";
  /** PAISE, always positive. `kind` carries the direction. */
  amountPaise: number;
  technicianId: string;
  technicianName: string;
  ticketId: string;
  /** `INST-240912` — what a person quotes. The UUID is beside it for the link. */
  ticketCode: string;
  /** As recorded when the money moved, never re-derived. */
  reason: string;
}

/* `Vendor` moved to `types/vendor.ts` when vendors became real. It used to
   describe a ticket-INTAKE source — intake channel, API credentials, lifetime
   ticket volume, "since" year — none of which has a backend source yet. A
   vendor is now the company whose products get installed, carrying a GSTIN and
   a contact, and it is the brand on every product model. The intake facts
   return with the jobs slice that can supply them. */
export * from "./vendor";

/* `Category` moved to `types/product.ts` when the product master became real.
   It was `{ name, models[], techs, active }` with no id, which made `name` the
   join key for technician certifications and ticket categories alike — so a
   rename silently orphaned both. It is now category → subcategory → model, each
   with a UUID. */

export interface User {
  id: string;
  name: string;
  email: string;
  /** Optional profile photo as a data URL. Absent → the initials avatar.
   *  Client-set today; a real upload endpoint replaces it later. */
  photoUrl?: string;
  role: Role;
  region: string;
  status: "Active" | "Invited" | "Suspended";
  last: string;
}

/* Territory types moved to `types/territory.ts` when the mapping became real —
   it is now derived from user assignments rather than its own mock records. */
