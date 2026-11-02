import { z } from "zod";
import { isE164, toE164 } from "@/utils/phone";
import type { PartsAddress, PartsAddressInput } from "@/types/technician";

/**
 * The parts delivery address form (Epic 6). The bounds are the server's —
 * line 3-240, city 2-80, landmark up to 120, a six-digit pincode — and the
 * pincode is checked against the geography master by `AddressFields` on screen
 * and by the server (422 `UNKNOWN_PINCODE`) on save.
 *
 * The contact phone is optional: blank means the technician's own phone.
 */
export const partsAddressSchema = z.object({
  line: z
    .string()
    .trim()
    .min(3, "Enter the street address")
    .max(240, "Keep the address to 240 characters"),
  city: z
    .string()
    .trim()
    .min(2, "Enter the city")
    .max(80, "Keep the city to 80 characters"),
  pincode: z.string().trim().regex(/^\d{6}$/, "Choose a 6-digit pincode"),
  landmark: z.string().trim().max(120, "Keep the landmark to 120 characters"),
  contactPhone: z
    .string()
    .trim()
    .refine((v) => v === "" || isE164(toE164(v)), "Enter a valid phone number"),
});

export type PartsAddressFormValues = z.infer<typeof partsAddressSchema>;

export const EMPTY_PARTS_ADDRESS: PartsAddressFormValues = {
  line: "",
  city: "",
  pincode: "",
  landmark: "",
  contactPhone: "",
};

/** The saved address as form values; nothing saved gives an empty form. */
export function toFormValues(
  saved: PartsAddress | null | undefined
): PartsAddressFormValues {
  if (!saved) return EMPTY_PARTS_ADDRESS;
  return {
    line: saved.line,
    city: saved.city,
    pincode: saved.pincode,
    landmark: saved.landmark ?? "",
    contactPhone: saved.contactPhone ?? "",
  };
}

/** The request body: blank optionals are omitted, the phone goes up as E.164. */
export function toPartsAddressInput(
  v: PartsAddressFormValues
): PartsAddressInput {
  const landmark = v.landmark.trim();
  const phone = v.contactPhone.trim();
  return {
    line: v.line.trim(),
    city: v.city.trim(),
    pincode: v.pincode.trim(),
    ...(landmark ? { landmark } : {}),
    ...(phone ? { contactPhone: toE164(phone) } : {}),
  };
}
