import { z } from "zod";
import { isE164, toE164 } from "@/utils/phone";
import type { PartnerStatus } from "@/types/partner";

/**
 * Appointment asks for a number and where the partner will work. The number is
 * the whole record until the invite it receives is completed, so a wrong one
 * silently invites a stranger — and because the invite goes over WhatsApp, it
 * must carry a country code rather than ten bare digits.
 */
export const partnerInviteSchema = z.object({
  phone: z
    .string()
    .trim()
    .refine((v) => isE164(toE164(v)), "Enter a valid mobile number with country code"),
  fullName: z.string().trim().max(255),
  /** Blank is allowed when the inviter holds exactly one region. */
  regionId: z.string(),
});

export type PartnerInviteValues = z.infer<typeof partnerInviteSchema>;

export const EMPTY_INVITE: PartnerInviteValues = {
  phone: "",
  fullName: "",
  regionId: "",
};

/** The status filter's options, in lifecycle order. */
export const PARTNER_STATUSES: PartnerStatus[] = [
  "pending",
  "sent",
  "failed",
  "registered",
  "cancelled",
];

/** Wire value → what a person reads. */
export const STATUS_LABEL: Record<PartnerStatus, string> = {
  pending: "Not sent",
  sent: "Invite sent",
  failed: "Delivery failed",
  registered: "Registered",
  cancelled: "Cancelled",
};

/** Static strings — an interpolated `text-${status}` is never generated. */
export const STATUS_CLASS: Record<PartnerStatus, string> = {
  pending: "text-ink-3",
  sent: "text-info",
  failed: "text-danger",
  registered: "text-ok",
  cancelled: "text-ink-3",
};
