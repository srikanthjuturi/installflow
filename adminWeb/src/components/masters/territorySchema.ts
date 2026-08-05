import { z } from "zod";

/**
 * Region → Regional Service Head → Area Service Manager → serviced pincodes.
 * A mapping with no pincodes services nothing, so at least one is required.
 */

/** Accepts commas, spaces or newlines so a pasted range works as typed. */
export function parsePincodes(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}

/** Sentinel option: the region does not exist yet, so it needs an RSH too. */
export const NEW_REGION = "__new__";

export const territorySchema = z
  .object({
    region: z.string().min(1, "Select a region"),
    newRegion: z.string().trim(),
    rsh: z.string().trim(),
    asm: z.string().trim().min(2, "Area Service Manager name is required"),
    area: z.string().trim().min(2, "Area is required"),
    pincodes: z
      .string()
      .trim()
      .refine((v) => parsePincodes(v).length > 0, "Enter at least one pincode")
      .refine(
        (v) => parsePincodes(v).every((p) => /^\d{6}$/.test(p)),
        "Every pincode must be 6 digits"
      ),
  })
  .superRefine((values, ctx) => {
    // An existing region already has its RSH; a new one has to name both.
    if (values.region !== NEW_REGION) return;
    if (values.newRegion.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["newRegion"],
        message: "Region name is required",
      });
    }
    if (values.rsh.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["rsh"],
        message: "Regional Service Head is required",
      });
    }
  });

export type TerritoryFormValues = z.infer<typeof territorySchema>;
