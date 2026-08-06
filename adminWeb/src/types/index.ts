export * from "./ticket";
export * from "./dashboard";

/**
 * Management hierarchy, widest scope first. Ops Staff do intake only.
 * Mirrors the backend's numeric codes 1–5 — see API_ROLE.
 */
export type Role = "Admin" | "NH" | "RSH" | "ASM" | "Ops Staff";

export interface Technician {
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

export interface Vendor {
  id: string;
  name: string;
  channel: "API" | "Excel" | "Manual";
  status: "Active" | "Paused";
  tickets: number;
  key: string;
  since: string;
}

export interface Category {
  name: string;
  models: string[];
  techs: number;
  active: boolean;
}

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

export interface AsmTerritory {
  name: string;
  area: string;
  initial: string;
  pincodes: string[];
}

export interface RegionTerritory {
  region: string;
  rsh: string;
  pincount: number;
  asms: AsmTerritory[];
}
export * from "./imports";
