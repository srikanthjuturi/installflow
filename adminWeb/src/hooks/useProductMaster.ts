import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createModel,
  createNode,
  deleteModel,
  deleteNode,
  listNodeTree,
  updateModel,
  updateNode,
} from "@/services/productMaster";
import { CERTIFY_DEPTH, flattenNodes } from "@/types/product";

export const productKeys = {
  all: ["product-master"] as const,
  /** Prefix — one invalidation refreshes the tree and every derived list. */
  tree: (includeInactive: boolean, vendorId?: string) =>
    ["product-master", "tree", includeInactive, vendorId ?? null] as const,
};

/**
 * The whole catalogue in one request.
 *
 * It is small (tens of rows) and feeds the Categories screen, the technician
 * form and ticket intake, so it is fetched once and cached long — a product
 * master changes a few times a year, not a few times a minute.
 */
export function useNodeTree(includeInactive = false, vendorId?: string) {
  return useQuery({
    queryKey: productKeys.tree(includeInactive, vendorId),
    queryFn: () => listNodeTree(includeInactive, vendorId),
    staleTime: 60 * 60 * 1000,
    // Nothing to ask for until a vendor is chosen, when one is being asked for.
    // Fetching the whole catalogue first and discarding it would flash the wrong
    // options into a dropdown somebody may already be opening.
    enabled: vendorId !== "",
  });
}

/**
 * Every node in the tree, flattened depth-first, each carrying its root's name
 * and its own breadcrumb.
 *
 * A rule can be set on ANY node, so this is the pick list for Rules Config's
 * scope selector. The breadcrumb matters there: names are unique only among
 * siblings, so *Sony › 32 inch* and *LG › 32 inch* would otherwise be two
 * identical rows.
 *
 * Certification is narrower — see `useCertifiableNodeOptions`.
 */
export function useNodeOptions() {
  const query = useNodeTree();
  const options = useMemo(() => flattenNodes(query.data), [query.data]);
  return { ...query, options };
}

/**
 * The nodes a technician may be certified on: MAIN sub-categories, meaning the
 * direct children of a root and nothing else.
 *
 * A tick still covers everything beneath it, so this narrows the choice without
 * narrowing the reach. The API enforces the same rule (`CERTIFY_DEPTH`), and
 * `api/app/core/product_tree.py` is where the reasoning is written down rather
 * than duplicated here.
 *
 * Deliberately NOT a change to `useNodeOptions`: Rules Config offers every
 * level, and folding the two would quietly narrow that too.
 */
export function useCertifiableNodeOptions() {
  const query = useNodeOptions();
  const options = useMemo(
    () => query.options.filter((o) => o.depth === CERTIFY_DEPTH),
    [query.options]
  );
  return { ...query, options };
}

/**
 * Every write invalidates the whole `product-master` prefix rather than the one
 * key it touched: renaming a node changes the flattened options, the technician
 * form's checkboxes and the ticket form's select, all of which read the same
 * tree — and with inheritance, editing one node can change what every node
 * below it resolves to.
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

export const useCreateNode = () =>
  useMasterMutation(createNode, "Couldn't add the category");
export const useUpdateNode = () =>
  useMasterMutation(updateNode, "Couldn't save the category");
export const useDeleteNode = () =>
  useMasterMutation(deleteNode, "Couldn't remove the category");

export const useCreateModel = () =>
  useMasterMutation(createModel, "Couldn't add the product model");
export const useUpdateModel = () =>
  useMasterMutation(updateModel, "Couldn't save the product model");
export const useDeleteModel = () =>
  useMasterMutation(deleteModel, "Couldn't remove the product model");
