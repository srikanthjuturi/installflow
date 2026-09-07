import { z } from "zod";
import { rupees } from "@/components/masters/categorySchema";

/**
 * Both prices, typed by the approver.
 *
 * `rupees` is imported from the product form rather than redefined here, and it
 * deliberately did not move: `components/tickets/ticketSchema` already imports
 * `SERVICE_TYPES` from the same file, so schema constants crossing slices is
 * this repo's habit, and the ceiling inside `rupees` mirrors a server CHECK — a
 * second copy is the copy that drifts.
 *
 * The two boxes ask the same questions the product form asks, with the same
 * words, because they are the same decision arriving a step later.
 */
export const approveSchema = z.object({
  technicianPayoutPaise: rupees("What the technician is paid is required"),
  vendorPricePaise: rupees("What the vendor is charged is required"),
});

/**
 * Why it was refused.
 *
 * Required, and with a floor above one character: the vendor reads this and it
 * is the only thing telling them what to change. "no" is a refusal they cannot
 * act on, and their next move would be to resubmit the same row and wait again.
 *
 * 255 because the server quotes it verbatim into a notification, whose `detail`
 * column is `String(255)` — a longer reason would reach their bell truncated
 * mid-word.
 */
export const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Say why, so they can fix it")
    .max(255, "Keep the reason under 255 characters"),
});

export type ApproveFormValues = z.infer<typeof approveSchema>;
export type RejectFormValues = z.infer<typeof rejectSchema>;
