import { z } from "zod";

/**
 * A vendor's own person.
 *
 * The company-user schema minus everything a vendor has no say in: no role (it
 * is always `vendor_user`) and no territory (a vendor holds none). Those are
 * absent rather than optional, so there is no field a caller could fill and be
 * quietly disappointed by.
 *
 * No password either: the server mints a temporary one and emails it, so there
 * is nothing for the vendor to invent or pass along.
 */
export const vendorUserSchema = z.object({
  fullName: z.string().trim().min(2, "Enter their name").max(255),
  email: z.string().trim().min(1, "Enter an email").pipe(z.email("Enter a valid email")),
  phone: z.string().trim().max(32),
});

export type VendorUserValues = z.infer<typeof vendorUserSchema>;

export const EMPTY_VENDOR_USER: VendorUserValues = {
  fullName: "",
  email: "",
  phone: "",
};

/** Edit takes neither the email nor a password — see the service for why. */
export const editVendorUserSchema = vendorUserSchema.pick({
  fullName: true,
  phone: true,
});

export type EditVendorUserValues = z.infer<typeof editVendorUserSchema>;
