import type { Role } from "@/types";

/**
 * Service partners — the two ways work reaches someone who is not an in-house
 * technician. NH, RSH and ASM appoint them; Ops Staff do not.
 *
 * Appointment collects **only a mobile number**. Everything else — name,
 * categories, pincodes, capacity — is filled in by the partner from the invite
 * that number receives, which is why a fresh record is `Invited` and carries
 * nothing else yet.
 */
export type PartnerKind = "Freelancer" | "Franchise";

/** `Invited` until the number completes registration. */
export type PartnerStatus = "Invited" | "Active" | "Inactive";

export interface Partner {
  id: string;
  kind: PartnerKind;
  phone: string;
  status: PartnerStatus;
  /** The management role that appointed them. */
  appointedBy: Role;
  /** ISO date of appointment. */
  appointedOn: string;
}
