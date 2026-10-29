import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { SERVICE_TYPES } from "@/components/masters/categorySchema";
import { REASON_MAX, REASON_MIN } from "@/lib/handOver";
import { PURCHASE_MODES, SERVICE_LEVELS } from "@/types/ticket";
import { istToday, offeredSlots } from "@/utils/slots";

/**
 * India mobile numbers — ten digits starting 6-9, optionally prefixed `+91`.
 * Shared by `customerPhone` (required) and `customerAltPhone` (A6, optional)
 * so the two boxes can never silently drift to different rules.
 */
const PHONE_REGEX = /^(\+91[\s-]?)?[6-9]\d{9}$/;

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
      .regex(PHONE_REGEX, "Enter a valid 10-digit Indian mobile number"),
    /**
     * A6: a second number for the same customer — a relative, a shop,
     * whoever else can let the technician in. Optional, so an empty box is
     * a complete ticket; typed, it has to be as real a number as the first
     * one, which is why it shares `PHONE_REGEX` rather than a looser rule.
     */
    customerAltPhone: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || PHONE_REGEX.test(v), {
        message: "Enter a valid 10-digit Indian mobile number",
      }),
    address: z.string().trim().min(1, "Address is required").max(500),
    city: z.string().trim().min(1, "City is required").max(120),
    state: z.string().trim().min(1, "State is required").max(120),
    pincode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Pincode must be 6 digits"),
    /**
     * Where the address is, when it was PICKED from the search box rather than
     * typed. Never entered by hand and never shown — `AddressFields` sets the
     * pair on a pick and nulls it on any edit.
     *
     * Not required, and no message: an address typed by hand is a complete
     * ticket. What it costs is the proof check — the technician's site photo
     * is then verified against the pincode instead of against this point.
     */
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),

    expectedDate: z.string().min(1, "Expected date is required"),
    /* A literal union rather than `z.coerce.number()`: coercion makes the
       schema's input type differ from its output, and react-hook-form then
       cannot reconcile the resolver with the form values. The radio group
       already hands over a number. */
    serviceLevelHours: z.union(
      [z.literal(12), z.literal(24), z.literal(36), z.literal(48)],
      { message: "Pick a service level" }
    ),
    /**
     * Both or neither — a half slot is not a time. ISO instants, set as a pair
     * by the window picker, never typed: a slot has to be one of the windows
     * the customer could have picked. See `utils/slots.ts`.
     */
    slotStart: z.string(),
    slotEnd: z.string(),

    /**
     * A2: a flag for the board — see `Ticket.isHighPriority`. No SLA
     * consequence and nothing a technician's eligibility reads; it is only
     * ever read by a person looking at the list.
     *
     * Plain `z.boolean()`, not `.default(false)` — a defaulted field's INPUT
     * type (optional) differs from its OUTPUT type (required), and that gap
     * is exactly what the note above `serviceLevelHours` warns about: RHF's
     * resolver cannot reconcile a schema whose input and output disagree
     * with `TicketFormValues`. The false default lives in the component's
     * `defaultValues` instead, where RHF already expects one.
     */
    isHighPriority: z.boolean(),

    /**
     * A7: where the unit was bought. The platform box only appears, on the
     * form, once this reads "online". Plain `z.enum`, for the same
     * input/output reason as `isHighPriority` above — "offline" is the
     * component's `defaultValues`, not a schema default.
     */
    purchaseMode: z.enum(PURCHASE_MODES),
    /**
     * Only meaningful when `purchaseMode` is "online" — the superRefine
     * below is what keeps the two from disagreeing. Optional even then:
     * the server allows "online, platform unspecified".
     */
    purchasePlatformId: z.string().optional(),
    /**
     * E1: the one free-text field for "where was it bought", read two
     * different ways by `ManualEntryForm`'s submit depending on
     * `purchaseMode` — the offline store name, or the online "Others"
     * platform name — the same split `TicketCreateRequest.
     * purchasePlatformName` documents server-side. Which of the two it
     * currently means is UI state (`platformChoice`, a sentinel that never
     * reaches this schema), not something this field's shape can express —
     * so there is nothing to validate beyond the server's own bound.
     */
    purchasePlatformName: z.string().trim().max(120).optional(),
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

    // A day that has already gone cannot be served. IST, not the browser's
    // zone: for five and a half hours every evening the two disagree about
    // what day it is, and the server judges this in IST.
    if (v.expectedDate && v.expectedDate < istToday()) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedDate"],
        message: "That date has already passed — pick today or later",
      });
    }

    if (Boolean(v.slotStart) !== Boolean(v.slotEnd)) {
      ctx.addIssue({
        code: "custom",
        path: [v.slotStart ? "slotEnd" : "slotStart"],
        message: "A slot needs both a start and an end",
      });
    }
    /*
     * The chosen window must still be on offer, re-derived at submit rather
     * than trusted from when the menu was drawn. A form left open past the
     * 90-minute lead time is holding a slot that has since expired, and the
     * server refuses it — better to say so on the field than to round-trip.
     *
     * Mirrors `check_slot_bookable`. Membership in the list is the whole rule:
     * it already carries "in the future", "far enough ahead", "a real working
     * window" and "inside the service level".
     */
    if (v.slotStart && v.slotEnd) {
      const open = offeredSlots(v.serviceLevelHours);
      const still = open.some(
        (s) => s.start === v.slotStart && s.end === v.slotEnd
      );
      if (!still) {
        ctx.addIssue({
          code: "custom",
          path: ["slotStart"],
          message: open.length
            ? "That window has passed — pick another"
            : `A ${v.serviceLevelHours}h service level leaves no window today. Choose a longer one, or leave the slot blank.`,
        });
      }
    }

    // A7: the pair's own invariant — mirrors the server's "a platform only
    // with an online purchase" rule, reported on the box that would
    // actually be carrying the stray value. The form clears this field the
    // moment the mode flips back to offline, so this is a defensive mirror
    // of the server rule rather than a state reachable through the UI.
    if (v.purchaseMode === "offline" && v.purchasePlatformId) {
      ctx.addIssue({
        code: "custom",
        path: ["purchasePlatformId"],
        message: "A platform only applies when the purchase was online",
      });
    }
  });

export type TicketFormValues = z.infer<typeof ticketSchema>;

/**
 * Moving a ticket that already exists.
 *
 * Deliberately does NOT re-derive the window against `offeredSlots` the way
 * `ticketSchema` does above. That check mirrors intake's rule — inside the
 * service level — and a ticket being re-slotted has usually blown it, so the
 * validator would refuse every window the server had just offered. The list
 * here comes from the API and the API re-derives it on submit; a second,
 * differently-bounded opinion in the browser would only be wrong.
 *
 * `reason` is required, unlike the technician's optional note in the app. That
 * door has the customer's own one-time code standing behind it. This one has
 * only the manager, so the sentence they type is the whole record of the call.
 */
export const rescheduleSchema = z.object({
  slotStart: z.string().min(1, "Pick a window"),
  reason: z
    .string()
    .trim()
    .min(3, "Say why it is moving — this is the only record of the call")
    .max(255, "Keep it under 255 characters"),
});

export type RescheduleFormValues = z.infer<typeof rescheduleSchema>;
export const rescheduleResolver = zodResolver(rescheduleSchema);

/**
 * Handing an unassigned ticket to another franchisee (Task 18). The reason's
 * bounds are the API's (3-255, trimmed) and its sentences are `reasonError`'s,
 * so the dialog's button and this resolver can never disagree.
 */
export const handOverSchema = z.object({
  franchiseeId: z.string().min(1, "Pick a franchisee"),
  reason: z
    .string()
    .trim()
    .min(REASON_MIN, "Say why you're handing it over.")
    .max(REASON_MAX, "Keep it under 255 characters."),
});

export type HandOverFormValues = z.infer<typeof handOverSchema>;
export const handOverResolver = zodResolver(handOverSchema);

/**
 * Giving a penalty back. Required for the same reason as a reschedule: nothing
 * stands behind it but the manager, and it returns pool money.
 *
 * 160, not 255 — the ledger row keeps these words verbatim in its `reason`
 * column, which is 160, and the API refuses anything longer.
 */
export const reversePenaltySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why it is being reversed — this is kept with the money")
    .max(160, "Keep it under 160 characters"),
});

export type ReversePenaltyFormValues = z.infer<typeof reversePenaltySchema>;
export const reversePenaltyResolver = zodResolver(reversePenaltySchema);

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

/**
 * A7: online vs offline, as radio cards beside `SERVICE_LEVEL_OPTIONS`. Only
 * two, fixed, so this is exempt from the single-option auto-fill rule the
 * same way the service level and SLA-type pickers are (hard rule 10).
 */
export const PURCHASE_MODE_OPTIONS = PURCHASE_MODES.map((mode) => ({
  value: mode,
  title: mode === "online" ? "Online" : "Offline",
}));
