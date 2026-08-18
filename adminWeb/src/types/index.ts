export * from "./ticket";
export * from "./dashboard";

/**
 * Management hierarchy, widest scope first. Ops Staff do intake only.
 * Mirrors the backend's numeric codes 1–5 — see API_ROLE.
 */
export type Role = "Admin" | "NH" | "RSH" | "ASM" | "Ops Staff";

/**
 * A candidate on the escalation shortlist.
 *
 * This is NOT the technician master record — that lives in `types/technician.ts`
 * and comes from the API. This shape stays because "who has bandwidth left for
 * this ticket" needs open assignments, and there is no jobs table yet; the
 * escalation screens read it from a mock until there is.
 */
export interface EligibleTechnician {
  id: string;
  name: string;
  phone: string;
  /** Optional profile photo as a data URL. Absent → the initials avatar.
   *  Client-set today; a real upload endpoint replaces it later. */
  photoUrl?: string;
  cats: string[];
  pincodes: string;
  /** Bandwidth is a plain jobs-per-day count. The Rules screen calls it
   *  "weighted by job type" — that contradiction is an open decision. */
  bwUsed: number;
  bwTotal: number;
  rating: number;
  status: "Active" | "Inactive";
  jobs: number;
  cancels: number;
  penalty: number;
  bonus: number;
  joined: string;
}

export interface Escalation {
  id: string;
  customer: string;
  product: string;
  city: string;
  pincode: string;
  slot: string;
  /** Time remaining until the confirmed slot. */
  left: string;
  reason: string;
  /** Funded by collected cancellation penalties. */
  pool: number;
}

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

export interface LedgerEntry {
  id: string;
  date: string;
  type: "Penalty" | "Bonus";
  tech: string;
  ticket: string;
  /** Negative for penalties, positive for bonuses. */
  amt: number;
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
export * from "./imports";
