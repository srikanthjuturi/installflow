/**
 * Product master transport — live FastAPI, not the mock client.
 *
 * Every write returns the affected category with its whole subtree, so the
 * console re-renders from one authoritative response instead of patching a
 * local tree and hoping it matches what the server did.
 */

import type {
  CreateCategoryInput,
  CreateModelInput,
  CreateSubcategoryInput,
  ProductCategory,
  UpdateCategoryInput,
  UpdateModelInput,
  UpdateSubcategoryInput,
} from "@/types/product";
import { apiDelete, apiGet, apiPost, apiPut } from "./http";

/**
 * The catalogue, whole or narrowed to one brand.
 *
 * `vendorId` returns only that vendor's models and only the levels above them
 * that still hold any — ticket intake picks the vendor first, so its category
 * and model pickers must not offer a path that dead-ends.
 */
export function listCategoryTree(
  includeInactive = false,
  vendorId?: string
): Promise<ProductCategory[]> {
  const query = new URLSearchParams();
  if (includeInactive) query.set("includeInactive", "true");
  if (vendorId) query.set("vendorId", vendorId);
  const qs = query.toString();
  return apiGet<ProductCategory[]>(`/masters/categories${qs ? `?${qs}` : ""}`);
}

/* -------------------------------------------------------------- categories */

export function createCategory(
  input: CreateCategoryInput
): Promise<ProductCategory> {
  return apiPost<ProductCategory>("/masters/categories", input);
}

export function updateCategory({
  id,
  ...body
}: UpdateCategoryInput): Promise<ProductCategory> {
  return apiPut<ProductCategory>(`/masters/categories/${id}`, body);
}

export function deleteCategory(id: string): Promise<null> {
  return apiDelete<null>(`/masters/categories/${id}`);
}

/* ----------------------------------------------------------- subcategories */

export function createSubcategory({
  categoryId,
  ...body
}: CreateSubcategoryInput): Promise<ProductCategory> {
  return apiPost<ProductCategory>(
    `/masters/categories/${categoryId}/subcategories`,
    body
  );
}

export function updateSubcategory({
  id,
  ...body
}: UpdateSubcategoryInput): Promise<ProductCategory> {
  return apiPut<ProductCategory>(`/masters/subcategories/${id}`, body);
}

export function deleteSubcategory(id: string): Promise<null> {
  return apiDelete<null>(`/masters/subcategories/${id}`);
}

/* ------------------------------------------------------------------ models */

export function createModel({
  subcategoryId,
  ...body
}: CreateModelInput): Promise<ProductCategory> {
  return apiPost<ProductCategory>(
    `/masters/subcategories/${subcategoryId}/models`,
    body
  );
}

export function updateModel({
  id,
  ...body
}: UpdateModelInput): Promise<ProductCategory> {
  return apiPut<ProductCategory>(`/masters/models/${id}`, body);
}

export function deleteModel(id: string): Promise<null> {
  return apiDelete<null>(`/masters/models/${id}`);
}
