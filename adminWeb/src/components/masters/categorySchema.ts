import { z } from "zod";
import type { ServiceType } from "@/types/product";
import { ICON_KEYS, type IconKey } from "./icons";

/** Active / Paused. Separate from deletion — a paused row still exists. */
export const CATEGORY_STATUSES = ["Active", "Paused"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

/** The picker only offers catalogue keys, but the form validates anyway. */
const iconKey = z.enum(ICON_KEYS as [IconKey, ...IconKey[]]);

const status = z.enum(CATEGORY_STATUSES);

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required"),
  iconKey,
  status,
});

export const subcategorySchema = z.object({
  name: z.string().trim().min(2, "Subcategory name is required"),
  /** Empty means "inherit the parent category's icon". */
  iconKey: iconKey.nullable(),
  status,
});

/** Photos per model. Mirrors MAX_IMAGES in app/features/masters/schemas.py. */
export const MAX_MODEL_IMAGES = 5;

/**
 * Mirrors the server rule: http(s) URLs, never `data:` ones, at most five.
 *
 * The API refuses base64 so a product photo cannot bloat every list response —
 * the photo itself lives in blob storage and the record keeps only its URL.
 * Nobody types these (the form uploads each crop and stores what comes back),
 * so the checks guard the seam rather than the typist.
 */
/**
 * What a technician can be sent to do with a model. Mirrors SERVICE_TYPES in
 * `api/app/core/service_types.py` — same order, which is the order the API
 * stores them in however the boxes were ticked.
 *
 * `satisfies` keeps this honest if the `ServiceType` union ever changes.
 */
export const SERVICE_TYPES = [
  "Installation + Demo",
  "Tech Visit",
  "Service",
] as const satisfies readonly ServiceType[];

/** One line each, shown beside the option so the choice is not a guess. */
export const SERVICE_TYPE_HINT: Record<ServiceType, string> = {
  "Installation + Demo": "Fit the unit and show the customer how to use it.",
  "Tech Visit": "Attend an installed unit to diagnose or check it.",
  Service: "Maintenance on a unit that is already installed.",
};

/** The ceiling, in rupees. Ten lakh is no install anybody does; it is here to
 *  catch a paise figure typed into a rupee box, which is the mistake these two
 *  fields invite and the one nobody would notice on a list screen. */
const MAX_RUPEES = 1_000_000;

/**
 * A required whole-rupee amount, typed as a string.
 *
 * `> 0` rather than `>= 0`, matching the CHECK on both tables: a free job is
 * not a cheap job, it is a missing price.
 */
const rupees = (missing: string) =>
  z
    .string()
    .trim()
    .min(1, missing)
    .refine((v) => /^\d{1,7}$/.test(v), "Enter a whole number of rupees")
    .refine((v) => Number(v) > 0, "Enter an amount above ₹0")
    .refine(
      (v) => Number(v) <= MAX_RUPEES,
      "That looks like paise — enter the amount in rupees",
    );

export const modelSchema = z.object({
  name: z.string().trim().min(1, "Model name is required"),
  /** The brand. Required — a model with no maker names nothing a technician
   *  can be sent to install, and a brand backfilled later is one nobody
   *  remembers. `min(1)` rather than `.uuid()`: the control stores "" when
   *  empty, and "Select a brand" is the message that belongs on an empty
   *  dropdown, not "invalid uuid". */
  vendorId: z.string().min(1, "Select a brand"),
  /** At least one — a model nobody can be sent to do anything with is not a
   *  model. Order does not matter here; the API stores catalogue order. */
  serviceTypes: z
    .array(z.enum(SERVICE_TYPES))
    .min(1, "Pick at least one service type"),
  /** Everything below is optional — a model is worth recording as soon as it
   *  has a name and a brand, and ops fill the rest in as they learn it. */
  capacity: z.string().trim().max(64, "Keep it short, e.g. 43 inch or 7 kg"),
  warrantyMonths: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,3}$/.test(v), "Enter a whole number of months")
    .refine(
      (v) => v === "" || Number(v) <= 240,
      "That looks like years — enter the number of months",
    ),
  /** What the job is worth to each side, in whole RUPEES as typed.
   *
   *  Required, unlike everything above them: the API columns are NOT NULL and a
   *  ticket stamps both at intake, so a model saved without them is one no
   *  ticket could ever be raised against. Better to refuse the save here, where
   *  the person can fix it, than to accept a row that fails on a vendor's
   *  intake form next week.
   *
   *  Strings, then coerced at submit — the `warrantyMonths` precedent directly
   *  above. `valueAsNumber` on an empty box yields NaN, which zod reports as
   *  "expected number, received nan" and nobody can act on. */
  technicianPayoutPaise: rupees("What the technician is paid is required"),
  vendorPricePaise: rupees("What the vendor is charged is required"),
  imageUrls: z
    .array(
      z
        .string()
        .trim()
        .refine(
          (v) => /^https?:\/\//i.test(v),
          "That photo was not stored. Upload it again."
        )
        .refine((v) => v.length <= 2048, "That photo link is too long")
    )
    .max(MAX_MODEL_IMAGES, `Up to ${MAX_MODEL_IMAGES} photos per model`),
  status,
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
export type SubcategoryFormValues = z.infer<typeof subcategorySchema>;
export type ModelFormValues = z.infer<typeof modelSchema>;

export const statusOf = (isActive: boolean): CategoryStatus =>
  isActive ? "Active" : "Paused";
