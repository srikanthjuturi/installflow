import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategory,
  createModel,
  createSubcategory,
  deleteCategory,
  deleteModel,
  deleteSubcategory,
  listCategoryTree,
  updateCategory,
  updateModel,
  updateSubcategory,
} from "@/services/productMaster";
import { flattenSubcategories } from "@/types/product";

export const productKeys = {
  all: ["product-master"] as const,
  /** Prefix — one invalidation refreshes the tree and every derived list. */
  tree: (includeInactive: boolean) =>
    ["product-master", "tree", includeInactive] as const,
};

/**
 * The whole catalogue in one request.
 *
 * It is small (tens of rows) and feeds the Categories screen, the technician
 * form and ticket intake, so it is fetched once and cached long — a product
 * master changes a few times a year, not a few times a minute.
 */
export function useCategoryTree(includeInactive = false) {
  return useQuery({
    queryKey: productKeys.tree(includeInactive),
    queryFn: () => listCategoryTree(includeInactive),
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Active subcategories, flattened, each carrying its parent's name.
 *
 * This is what a technician certifies on, so it is the pick list for the
 * technician form and the ticket form's second select.
 */
export function useSubcategoryOptions() {
  const query = useCategoryTree();
  const options = useMemo(
    () => flattenSubcategories(query.data),
    [query.data]
  );
  return { ...query, options };
}

/**
 * Every write invalidates the whole `product-master` prefix rather than the one
 * key it touched: a subcategory rename changes the flattened options, the
 * technician form's checkboxes and the ticket form's select, all of which read
 * the same tree.
 */
function useMasterMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export const useCreateCategory = () =>
  useMasterMutation(createCategory, "Couldn't add the category");
export const useUpdateCategory = () =>
  useMasterMutation(updateCategory, "Couldn't save the category");
export const useDeleteCategory = () =>
  useMasterMutation(deleteCategory, "Couldn't remove the category");

export const useCreateSubcategory = () =>
  useMasterMutation(createSubcategory, "Couldn't add the subcategory");
export const useUpdateSubcategory = () =>
  useMasterMutation(updateSubcategory, "Couldn't save the subcategory");
export const useDeleteSubcategory = () =>
  useMasterMutation(deleteSubcategory, "Couldn't remove the subcategory");

export const useCreateModel = () =>
  useMasterMutation(createModel, "Couldn't add the product model");
export const useUpdateModel = () =>
  useMasterMutation(updateModel, "Couldn't save the product model");
export const useDeleteModel = () =>
  useMasterMutation(deleteModel, "Couldn't remove the product model");
