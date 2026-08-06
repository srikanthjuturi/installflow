import { z } from "zod";
import type { PartnerStatus } from "@/types";

/**
 * Appointment asks for one thing. The number is the whole record until the
 * invite it receives is completed, so it is the only field that can be wrong
 * here — and a wrong one silently invites a stranger.
 */
export const partnerInviteSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(
      /^(\+91[\s-]?)?[6-9]\d{9}$/,
      "Enter a valid 10-digit Indian mobile number"
    ),
});

export type PartnerInviteValues = z.infer<typeof partnerInviteSchema>;

/** The status filter's options, in lifecycle order. */
export const PARTNER_STATUSES: PartnerStatus[] = [
  "Invited",
  "Active",
  "Inactive",
];
