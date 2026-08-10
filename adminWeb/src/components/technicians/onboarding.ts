import { z } from "zod";
import { isE164, toE164 } from "@/utils/phone";
import type {
  InviteStatus,
  OnboardingMode,
  RegisteredBy,
} from "@/types/technician";

/**
 * Onboarding presentation: the lifecycle vocabulary shared by the table, the
 * row actions and the profile card, plus the invite form's schema.
 */

export const INVITE_STATUSES: InviteStatus[] = [
  "pending",
  "sent",
  "failed",
  "registered",
  "cancelled",
  "expired",
];

export const STATUS_LABEL: Record<InviteStatus, string> = {
  pending: "Not sent",
  sent: "Invite sent",
  failed: "Delivery failed",
  registered: "Registered",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Static strings — an interpolated `text-${status}` is never generated. */
export const STATUS_CLASS: Record<InviteStatus, string> = {
  pending: "text-ink-3",
  sent: "text-info",
  failed: "text-danger",
  registered: "text-ok",
  cancelled: "text-ink-3",
  expired: "text-warn",
};

export const STATUS_DOT: Record<InviteStatus, string> = {
  pending: "bg-ink-3",
  sent: "bg-info",
  failed: "bg-danger",
  registered: "bg-ok",
  cancelled: "bg-ink-3",
  expired: "bg-warn",
};

export const MODE_LABEL: Record<OnboardingMode, string> = {
  invite: "Self-registered",
  direct: "Added by manager",
};

export const REGISTERED_BY_LABEL: Record<RegisteredBy, string> = {
  self: "The technician",
  manager: "Their manager",
};

/** Statuses a manager can still act on. */
export const isResendable = (status: InviteStatus) =>
  status === "pending" || status === "sent" || status === "failed";

/* ----------------------------------------------------------------- schema */

export const inviteSchema = z.object({
  phone: z
    .string()
    .trim()
    .refine(
      (v) => isE164(toE164(v)),
      "Enter a valid mobile number with country code"
    ),
  /** Blank is allowed when the inviter holds exactly one region. */
  regionId: z.string(),
});

export type InviteFormValues = z.infer<typeof inviteSchema>;

export const EMPTY_INVITE: InviteFormValues = { phone: "", regionId: "" };
