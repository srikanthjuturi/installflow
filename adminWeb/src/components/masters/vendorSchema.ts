import { z } from "zod";
import type { Vendor } from "@/types";

/**
 * §4 — there are exactly three intake channels, and only one of them is an
 * integration. Most vendors have no CRM, so Excel and Manual are primary
 * paths rather than fallbacks. `satisfies` keeps this list honest if the
 * `Vendor` union ever changes.
 */
export const INTAKE_CHANNELS = ["API", "Excel", "Manual"] as const satisfies readonly Vendor["channel"][];

export const VENDOR_STATUSES = ["Active", "Paused"] as const satisfies readonly Vendor["status"][];

/** One line per channel, shown under the select so the choice is not a guess. */
export const CHANNEL_HINT: Record<Vendor["channel"], string> = {
  API: "Tickets are pushed from the vendor's own system.",
  Excel: "Ops upload the vendor's spreadsheet.",
  Manual: "Ops key each ticket in by hand.",
};

/**
 * No API key field, by design. The key is issued server-side and only ever
 * returned masked, so there is nothing here for anyone to type or paste.
 */
export const vendorSchema = z.object({
  name: z.string().trim().min(2, "Vendor name is required"),
  channel: z.enum(INTAKE_CHANNELS),
  status: z.enum(VENDOR_STATUSES),
});

export type VendorFormValues = z.infer<typeof vendorSchema>;
