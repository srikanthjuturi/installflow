import type { IconKey } from "@/components/masters/icons";

/**
 * The product master, three levels deep: category → subcategory → model.
 *
 * Everything carries a UUID `id`. The old flat `Category` was keyed by `name`,
 * which meant a rename silently orphaned every technician and ticket that
 * referenced it — see `types/index.ts` for what is left of it during the
 * migration.
 *
 * A technician certifies on a SUBCATEGORY. That is the level a job offer
 * matches on, and the level the technician app draws one tile per.
 */

/**
 * What a technician can be sent to do with a model.
 *
 * Mirrors SERVICE_TYPES in `api/app/core/service_types.py`. A model declares
 * which it supports, and that is what a ticket raised against it will be
 * allowed to ask for — the ticket side reads this when the jobs slice lands.
 */
export type ServiceType = "Installation + Demo" | "Tech Visit" | "Service";

export interface ProductModel {
  id: string;
  subcategoryId: string;
  /** The brand — a vendor of this company. Mandatory. */
  vendorId: string;
  /** Resolved by the API, so no list fetches the vendor list to draw a row. */
  vendorName: string;
  name: string;
  /** At least one, always in catalogue order — the API normalises it. */
  serviceTypes: ServiceType[];
  /**
   * Size or rating — "43 inch", "7 kg", "340 L".
   *
   * Its own field rather than part of the name, which is where it lives in the
   * seeded rows and where it cannot be sorted, filtered or shown on its own.
   */
  capacity: string | null;
  /** 0–240. Null means nobody has recorded it yet, not "no warranty". */
  warrantyMonths: number | null;
  /**
   * What a technician earns for one job on this model, in PAISE.
   *
   * `null` NEVER means unpriced — the column is NOT NULL. It means the caller
   * is a **vendor**, and the server withholds this from them: what we pay a
   * technician is not part of what a vendor bought. Ops always get a number.
   */
  technicianPayoutPaise: number | null;
  /** What the vendor is charged to raise one of these, in PAISE. Everyone who
   *  can see the model sees this — including the vendor, whose price it is. */
  vendorPricePaise: number;
  /**
   * Up to five http(s) URLs into blob storage, ordered — the first is the
   * thumbnail. The API rejects `data:` on purpose: a base64 photo in every list
   * response is expensive, so the file is uploaded and only its URL stored.
   */
  imageUrls: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface ProductSubcategory {
  id: string;
  categoryId: string;
  name: string;
  /** Already resolved by the API — the subcategory's own icon, or its parent's. */
  iconKey: IconKey;
  /** What is actually stored. `null` means "inherits", which the form shows. */
  ownIconKey: IconKey | null;
  isActive: boolean;
  sortOrder: number;
  /** Certified technicians. A real count, not seed data. */
  technicianCount: number;
  models: ProductModel[];
}

export interface ProductCategory {
  id: string;
  name: string;
  iconKey: IconKey;
  isActive: boolean;
  sortOrder: number;
  subcategories: ProductSubcategory[];
}

/* ----------------------------------------------------------------- inputs */

export interface CreateCategoryInput {
  name: string;
  iconKey: IconKey;
  isActive: boolean;
}

export interface UpdateCategoryInput {
  id: string;
  name?: string;
  iconKey?: IconKey;
  isActive?: boolean;
}

export interface CreateSubcategoryInput {
  categoryId: string;
  name: string;
  /** Omit to inherit the parent category's icon. */
  iconKey?: IconKey | null;
  isActive: boolean;
}

export interface UpdateSubcategoryInput {
  id: string;
  name?: string;
  iconKey?: IconKey | null;
  isActive?: boolean;
}

export interface CreateModelInput {
  subcategoryId: string;
  name: string;
  vendorId: string;
  serviceTypes: ServiceType[];
  capacity?: string | null;
  warrantyMonths?: number | null;
  /** Both REQUIRED, in paise. The API columns are NOT NULL, so a model saved
   *  without them is one no ticket could be raised against. */
  technicianPayoutPaise: number;
  vendorPricePaise: number;
  imageUrls?: string[];
  isActive: boolean;
}

export interface UpdateModelInput {
  id: string;
  name?: string;
  /** Re-branding is allowed; clearing the brand is not. */
  vendorId?: string;
  /** Sent whole — omit to leave alone; an empty array is refused. */
  serviceTypes?: ServiceType[];
  capacity?: string | null;
  warrantyMonths?: number | null;
  /** Repricing is allowed; UNpricing is not, so omit to leave alone — there is
   *  no null that clears these, the way there is for `capacity`. */
  technicianPayoutPaise?: number;
  vendorPricePaise?: number;
  /** Sent whole — an empty array clears the gallery. */
  imageUrls?: string[];
  isActive?: boolean;
}

/* ------------------------------------------------------------- flattening */

export interface SubcategoryOption {
  id: string;
  name: string;
  iconKey: IconKey;
  categoryId: string;
  categoryName: string;
}

/**
 * Every subcategory with its parent's name attached, in tree order.
 *
 * The technician form and the eligibility shortlist both need a flat pick list
 * grouped by category; deriving it here keeps that grouping in one place rather
 * than in each consumer.
 */
export function flattenSubcategories(
  tree: ProductCategory[] | undefined
): SubcategoryOption[] {
  return (tree ?? []).flatMap((category) =>
    category.subcategories.map((sub) => ({
      id: sub.id,
      name: sub.name,
      iconKey: sub.iconKey,
      categoryId: category.id,
      categoryName: category.name,
    }))
  );
}

/** Resolve ids back to display names — lists store ids, tables show names. */
export function subcategoryNames(
  options: SubcategoryOption[],
  ids: string[]
): string[] {
  const byId = new Map(options.map((o) => [o.id, o.name]));
  return ids.map((id) => byId.get(id) ?? "—");
}
