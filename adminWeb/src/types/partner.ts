/**
 * Service partners — the two ways work reaches someone who is not an in-house
 * technician. Admin, NH, RH and AM appoint them; the partner then registers in
 * the **technician** app from a WhatsApp invite.
 *
 * Appointment collects a mobile number (and a region). Everything else — name,
 * categories, pincodes, capacity — is filled in by the partner during that
 * registration, which is why a fresh record carries nothing else yet.
 */

export type PartnerKind = "Freelancer" | "Franchise";

/** The wire uses lower-case; the console's two screens use the labels above. */
export type PartnerType = "freelancer" | "franchise";

/**
 * Lifecycle. `sent` means WhatsApp accepted the message — not that it arrived;
 * that needs a delivery webhook, which is a later phase.
 */
export type PartnerStatus =
  | "pending"
  | "sent"
  | "failed"
  | "registered"
  | "cancelled";

export interface PartnerInvite {
  id: string;
  partnerType: PartnerType;
  phone: string;
  fullName: string | null;
  status: PartnerStatus;
  regionId: string;
  regionName: string;
  /** Who sent the link — the tracking half of this feature. */
  invitedByName: string | null;
  invitedByEmail: string | null;
  inviteLink: string;
  /** Why WhatsApp refused, when it did. */
  failureReason: string | null;
  sentAt: string | null;
  registeredAt: string | null;
  createdAt: string;
}

/** Body for `POST /partners/invites`. */
export interface CreateInviteInput {
  partnerType: PartnerType;
  phone: string;
  fullName?: string | null;
  /** Optional for someone who holds exactly one region. */
  regionId?: string | null;
}

export const PARTNER_TYPE_OF: Record<PartnerKind, PartnerType> = {
  Freelancer: "freelancer",
  Franchise: "franchise",
};
