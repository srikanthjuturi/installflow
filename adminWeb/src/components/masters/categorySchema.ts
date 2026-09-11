import { z } from "zod";
import type { ServiceType } from "@/types/product";
import { ICON_KEYS, type IconKey } from "./icons";

/** Active / Paused. Separate from deletion — a paused row still exists. */
export const CATEGORY_STATUSES = ["Active", "Paused"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

/** The picker only offers catalogue keys, but the form validates anyway. */
const iconKey = z.enum(ICON_KEYS as [IconKey, ...IconKey[]]);

const status = z.enum(CATEGORY_STATUSES);

/** Fields per row. Mirrors MAX_PARAMETERS in `app/core/product_tree.py`. */
export const MAX_PARAMETERS = 20;

/**
 * The repeatable name/value rows — the "Add field" control on both dialogs.
 *
 * Wrapped in an object rather than a bare pair because `useFieldArray` keys on
 * one, which is also what stops the inputs losing focus on every re-render —
 * the same reason `rulesSchema` wraps its bonus amounts.
 *
 * Blank rows are allowed through validation and dropped at submit: somebody who
 * clicks Add and changes their mind should not have to find the × to save.
 * A row with a value and NO name is a mistake worth naming, though — it would
 * silently vanish.
 */
const parameterRows = (requireValue: boolean) =>
  z
    .array(
      z.object({
        name: z.string().trim().max(64, "Keep the field name short"),
        value: z.string().trim().max(255, "Keep the value short"),
      })
    )
    .max(MAX_PARAMETERS, `Up to ${MAX_PARAMETERS} fields`)
    .superRefine((rows, ctx) => {
      const seen = new Map<string, number>();
      rows.forEach((row, i) => {
        const name = row.name.trim();
        if (!name) {
          if (row.value.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [i, "name"],
              message: "Name this field, or clear the value",
            });
          }
          return;
        }
        if (requireValue && !row.value.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "value"],
            message: "Give it a value, or remove the field",
          });
        }
        const key = name.toLowerCase();
        const first = seen.get(key);
        if (first === undefined) {
          seen.set(key, i);
        } else {
          // Case-insensitive, matching the server: RAM and ram are one field to
          // everybody except a dictionary, and keeping the last silently would
          // hide the typo.
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "name"],
            message: `${name} is already listed above`,
          });
        }
      });
    });

/**
 * The last sub-category's field TEMPLATE. Names matter; a value is an optional
 * default the product form starts from.
 */
export const templateSchema = parameterRows(false);

/**
 * A PRODUCT's fields. Every one needs a value — this is the answer, not the
 * question, and a named field left blank reaches a technician as a blank line.
 */
export const parametersSchema = parameterRows(true);

export const nodeSchema = z.object({
  name: z.string().trim().min(2, "Category name is required"),
  /** Empty means "inherit the nearest ancestor's icon". A root has no ancestor,
   *  so its own is what everything below it falls back to — but it is still
   *  optional, and an unset one resolves to the default glyph. */
  iconKey: iconKey.nullable(),
  /** "This is the last sub-category" — products hang off it instead of more
   *  levels. Never offered on a root; the dialog hides the box there. */
  isLeaf: z.boolean(),
  /** Only collected when `isLeaf` is ticked; the dialog hides the control
   *  otherwise and the submit sends an empty list. */
  parameters: templateSchema,
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
 *
 * Exported for the approvals dialog, which asks for the same pair — it does not
 * MOVE, and that is deliberate on two counts. `components/tickets/ticketSchema`
 * already imports `SERVICE_TYPES` from this file, so schema constants crossing
 * slices is this repo's existing habit and the component-tier rule is written
 * about markup. And the ceiling here mirrors a server CHECK: a second copy is
 * the copy that drifts the first time somebody tunes it. Promote to
 * `lib/rupees.ts` if a third consumer ever appears.
 */
export const rupees = (missing: string) =>
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

/**
 * A product form, with or without the two price boxes.
 *
 * A factory for the same reason `parameterRows` above is one: the shape differs
 * by who is filling it in, and validating two fields that are not on screen
 * refuses a save with a message nobody can act on.
 *
 * `withPricing` is false for a VENDOR submitting to their own book. They never
 * set a price — a National Head types both at approval — so the boxes are
 * absent, and `vendorId` is theirs and shown rather than offered. The BRAND is
 * still theirs to pick, from their own approved brands.
 */
export const modelSchema = (withPricing = true) =>
  baseModelSchema.extend(
    withPricing
      ? {
          technicianPayoutPaise: rupees(
            "What the technician is paid is required"
          ),
          vendorPricePaise: rupees("What the vendor is charged is required"),
        }
      : {
          // Present but unvalidated, so `ModelFormValues` stays one type and
          // the shared submit path does not need a second branch to read them.
          // They are never rendered and never sent when `withPricing` is off.
          technicianPayoutPaise: z.string(),
          vendorPricePaise: z.string(),
        }
  );

const baseModelSchema = z.object({
  name: z.string().trim().min(1, "Model name is required"),
  /** The vendor who supplies it. Required — a product nobody supplies is one
   *  no ticket can be raised against. `min(1)` rather than `.uuid()`: the
   *  control stores "" when empty, and "Select a vendor" is the message that
   *  belongs on an empty dropdown, not "invalid uuid". */
  vendorId: z.string().min(1, "Select a vendor"),
  /** One of that vendor's approved brands — what is printed on the unit, and
   *  what every row shows. Required for the same reason as the vendor. */
  brandId: z.string().min(1, "Select a brand"),
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
  /** Prose about this product. Not a parameter — it has no name to inherit
   *  under, and it is read as a sentence rather than looked up. */
  notes: z.string().trim().max(2000, "Keep the note under 2,000 characters"),
  parameters: parametersSchema,
  status,
});

export type NodeFormValues = z.infer<typeof nodeSchema>;
/**
 * One type for both modes. The price fields are always PRESENT — as validated
 * rupee strings for ops, as unvalidated ones for a vendor — so the form, its
 * defaults and its submit path stay single-shape and only the resolver and the
 * rendered fields differ.
 *
 * The two amounts are named `…Paise` and hold whole RUPEES as typed. Strings,
 * then coerced at submit — the `warrantyMonths` precedent above.
 * `valueAsNumber` on an empty box yields NaN, which zod reports as "expected
 * number, received nan" and nobody can act on.
 */
export type ModelFormValues = z.infer<ReturnType<typeof modelSchema>>;
export type ParameterRow = z.infer<typeof parametersSchema>[number];

/** Drop the blank rows a user added and abandoned. */
export function cleanParameters(rows: ParameterRow[]) {
  return rows
    .map((row) => ({ name: row.name.trim(), value: row.value.trim() }))
    .filter((row) => row.name.length > 0);
}

/** The same, for a TEMPLATE — where a row with no value is the normal case. */
export const cleanTemplate = cleanParameters;

export const statusOf = (isActive: boolean): CategoryStatus =>
  isActive ? "Active" : "Paused";
