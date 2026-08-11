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

/**
 * Mirrors the server rule: an http(s) URL, never a `data:` one.
 *
 * The API refuses base64 so a product photo cannot bloat every list response,
 * and so moving to blob storage later stays a service change. Rejecting it here
 * too means the user finds out while typing rather than on submit.
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
  imageUrl: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^https?:\/\//i.test(v),
      "Enter a link starting with http:// or https://"
    )
    .refine((v) => v.length <= 2048, "That link is too long"),
  status,
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
export type SubcategoryFormValues = z.infer<typeof subcategorySchema>;
export type ModelFormValues = z.infer<typeof modelSchema>;

export const statusOf = (isActive: boolean): CategoryStatus =>
  isActive ? "Active" : "Paused";
