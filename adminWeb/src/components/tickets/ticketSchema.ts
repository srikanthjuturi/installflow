import { z } from "zod";
import { SERVICE_TYPES } from "@/components/masters/categorySchema";
import { SERVICE_LEVELS } from "@/types/ticket";

/**
 * §4's required fields, plus what intake has since learned it needs: a full
 * address to navigate to, the service type the job actually is, the customer's
 * problem when that type needs one, and the serial we expect to find on the box.
 *
 * The same rules the Excel importer will validate row by row.
 */
export const ticketSchema = z
  .object({
    vendorId: z.string().min(1, "Select a vendor"),
    /**
     * A subcategory id — Television, Air Conditioner. This is what the Category
     * dropdown offers and what a job offer matches a technician on; the parent
     * category (Electric, Home Appliance) is only the dropdown's group heading.
     */
    subcategoryId: z.string().min(1, "Select a category"),
    modelId: z.string().min(1, "Select a product model"),
    /** Narrowed by the chosen model to what it declares it supports. */
    serviceType: z.enum(SERVICE_TYPES, { message: "Select a service type" }),
    /** Required for Tech Visit and Service — see the superRefine below. */
    description: z.string().trim().max(2000),
    /** The EXPECTED serial, off the invoice. Optional: ops often won't have it. */
    // Required since vendors raise their own tickets: they hold the invoice,
    // so it is knowable at intake — and the AI proof check always has an
    // expected serial to compare the photographed one against.
    serialNumber: z.string().trim().min(1, "Enter the serial number").max(64),

    customerName: z.string().trim().min(2, "Customer name is required"),
    customerPhone: z
      .string()
      .trim()
      .regex(
        /^(\+91[\s-]?)?[6-9]\d{9}$/,
        "Enter a valid 10-digit Indian mobile number"
      ),
    address: z.string().trim().min(1, "Address is required").max(500),
    city: z.string().trim().min(1, "City is required").max(120),
    state: z.string().trim().min(1, "State is required").max(120),
    pincode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Pincode must be 6 digits"),

    expectedDate: z.string().min(1, "Expected date is required"),
    /* A literal union rather than `z.coerce.number()`: coercion makes the
       schema's input type differ from its output, and react-hook-form then
       cannot reconcile the resolver with the form values. The radio group
       already hands over a number. */
    serviceLevelHours: z.union(
      [z.literal(12), z.literal(24), z.literal(36), z.literal(48)],
      { message: "Pick a service level" }
    ),
    /** Both or neither — a half slot is not a time. `datetime-local` strings. */
    slotStart: z.string(),
    slotEnd: z.string(),
  })
  .superRefine((v, ctx) => {
    // Mirrors the server rule. Reported on the field itself rather than at the
    // form root, so the message lands where the user has to act.
    const needsProblem =
      v.serviceType === "Tech Visit" || v.serviceType === "Service";
    if (needsProblem && v.description.length < 10) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: `Describe the problem — a ${v.serviceType} needs to say what is wrong, or the technician arrives blind`,
      });
    }
    if (!needsProblem && v.description.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: "An installation & demo ticket doesn't take a description",
      });
    }

    if (Boolean(v.slotStart) !== Boolean(v.slotEnd)) {
      ctx.addIssue({
        code: "custom",
        path: [v.slotStart ? "slotEnd" : "slotStart"],
        message: "A slot needs both a start and an end",
      });
    }
    if (v.slotStart && v.slotEnd && v.slotEnd <= v.slotStart) {
      ctx.addIssue({
        code: "custom",
        path: ["slotEnd"],
        message: "The slot must end after it starts",
      });
    }
  });

export type TicketFormValues = z.infer<typeof ticketSchema>;

/**
 * The four service levels, as radio cards.
 *
 * The sub-line says what the number actually measures. The old copy read "Slot
 * within 24h of confirmation", which was the prototype's reading and the
 * opposite of the one taken: the window opens when the ticket is RAISED, so a
 * customer who never answers burns it.
 */
export const SERVICE_LEVEL_OPTIONS = SERVICE_LEVELS.map((hours) => ({
  value: hours,
  title: `${hours}-hour`,
  detail: `Slot must start within ${hours}h of creation`,
}));
