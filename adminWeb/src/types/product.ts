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

export interface ProductModel {
  id: string;
  subcategoryId: string;
  name: string;
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
   * An http(s) URL. The API rejects `data:` on purpose — a base64 photo in
   * every list response is expensive, and refusing it keeps the eventual move
   * to blob storage a service change rather than a data migration.
   */
  imageUrl: string | null;
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
  capacity?: string | null;
  warrantyMonths?: number | null;
  imageUrl?: string | null;
  isActive: boolean;
}

export interface UpdateModelInput {
  id: string;
  name?: string;
  capacity?: string | null;
  warrantyMonths?: number | null;
  imageUrl?: string | null;
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
