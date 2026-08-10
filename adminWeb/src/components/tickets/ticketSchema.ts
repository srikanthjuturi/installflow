import { z } from "zod";

/**
 * The required fields §4 lists for every ticket, regardless of intake
 * channel. The same rules the Excel importer validates row-by-row.
 */
export const ticketSchema = z.object({
  vendor: z.string().min(1, "Select a vendor"),
  /**
   * A subcategory id — Television, Air Conditioner. This is what the Category
   * dropdown offers and what a job offer matches a technician on; the parent
   * category (Electric, Home Appliance) is only the dropdown's group heading.
   */
  subcategoryId: z.string().min(1, "Select a category"),
  modelId: z.string().min(1, "Select a product model"),
  requestType: z.string().min(1, "Select a request type"),
  customer: z.string().trim().min(2, "Customer name is required"),
  mobile: z
    .string()
    .trim()
    .regex(
      /^(\+91[\s-]?)?[6-9]\d{9}$/,
      "Enter a valid 10-digit Indian mobile number"
    ),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Pincode must be 6 digits"),
  expected: z.string().min(1, "Expected date is required"),
  slaType: z.enum(["24h", "48h"]),
});

export type TicketFormValues = z.infer<typeof ticketSchema>;

/**
 * What the form hands upward once the ids are resolved to the names a ticket
 * records. The ids ride along so ticket intake is ready for the API without
 * another pass over this form.
 */
export interface TicketSubmitValues
  extends Omit<TicketFormValues, "subcategoryId" | "modelId"> {
  /** The subcategory NAME. `Ticket.category` has always held this level. */
  category: string;
  /** The model name. */
  product: string;
  subcategoryId: string;
  modelId: string;
}

export const SLA_OPTIONS = [
  {
    value: "24h" as const,
    title: "24-hour SLA",
    detail: "Slot within 24h of confirmation",
  },
  {
    value: "48h" as const,
    title: "48-hour SLA",
    detail: "Slot within 48h of confirmation",
  },
];
