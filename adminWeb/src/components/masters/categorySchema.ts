import { z } from "zod";
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
export const modelSchema = z.object({
  name: z.string().trim().min(1, "Model name is required"),
  /** Everything below is optional — a model is worth recording as soon as it
   *  has a name, and ops fill the rest in as they learn it. */
  capacity: z.string().trim().max(64, "Keep it short, e.g. 43 inch or 7 kg"),
  warrantyMonths: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,3}$/.test(v), "Enter a whole number of months")
    .refine(
      (v) => v === "" || Number(v) <= 240,
      "That looks like years — enter the number of months",
    ),
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
