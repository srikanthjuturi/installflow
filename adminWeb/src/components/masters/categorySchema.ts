import { z } from "zod";

export const CATEGORY_STATUSES = ["Active", "Paused"] as const;

/**
 * A category is meaningless without at least one product model — the manual
 * entry form picks a model straight out of this list — so the repeatable list
 * is required, not decorative.
 *
 * The certified-technician count is absent on purpose: it is derived from
 * technician records, never typed in here.
 */
export const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required"),
  models: z
    .array(
      z.object({ name: z.string().trim().min(1, "Model name is required") })
    )
    .min(1, "Add at least one product model"),
  status: z.enum(CATEGORY_STATUSES),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
