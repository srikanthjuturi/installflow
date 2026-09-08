import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addOwnSerials,
  addSerials,
  createModel,
  createNode,
  deleteModel,
  deleteNode,
  deleteOwnModel,
  deleteOwnSerial,
  deleteSerial,
  importOwnSerials,
  importSerials,
  listNodeTree,
  listSerials,
  resubmitModel,
  submitModel,
  submitNode,
  updateModel,
  updateNode,
  updateOwnSerial,
  updateSerial,
  type TreePurpose,
} from "@/services/productMaster";
import { CERTIFY_DEPTH, flattenNodes } from "@/types/product";
import type { ListParams } from "@/types/api";

export const productKeys = {
  all: ["product-master"] as const,
  /** Prefix — one invalidation refreshes the tree and every derived list.
   *
   *  `purpose` is part of the key because the two reads answer different
   *  questions: an intake read hides unapproved products and prunes what that
   *  empties, a catalogue read does not. Sharing one entry would let a picker
   *  render from a maintenance screen's cache and offer a product nobody can
   *  raise a ticket for. */
  tree: (
    includeInactive: boolean,
    vendorId?: string,
    purpose: TreePurpose = "catalogue"
  ) =>
    [
      "product-master",
      "tree",
      includeInactive,
      vendorId ?? null,
      purpose,
    ] as const,
};

/**
 * The whole catalogue in one request.
 *
 * It is small (tens of rows) and feeds the Categories screen, the technician
 * form and ticket intake, so it is fetched once and cached long — a product
 * master changes a few times a year, not a few times a minute.
 */
export function useNodeTree(
  includeInactive = false,
  vendorId?: string,
  purpose: TreePurpose = "catalogue"
) {
  return useQuery({
    queryKey: productKeys.tree(includeInactive, vendorId, purpose),
    queryFn: () => listNodeTree(includeInactive, vendorId, purpose),
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

/* A vendor's own writes. Same invalidation, different endpoints — the server
   pins the vendor, stamps the product pending and tells staff there is
   something to price. */
export const useSubmitNode = () =>
  useMasterMutation(submitNode, "Couldn't add the category");
export const useSubmitModel = () =>
  useMasterMutation(submitModel, "Couldn't send the product for approval");
export const useResubmitModel = () =>
  useMasterMutation(resubmitModel, "Couldn't save the product");
export const useDeleteOwnModel = () =>
  useMasterMutation(deleteOwnModel, "Couldn't remove the product");

export const useUpdateModel = () =>
  useMasterMutation(updateModel, "Couldn't save the product model");
export const useDeleteModel = () =>
  useMasterMutation(deleteModel, "Couldn't remove the product model");

/* ── model-wise serial numbers ─────────────────────────────────────────────── */
//
// Their own query key rather than a slice of the tree. The tree is fetched
// whole and cached long because it is tens of rows; a model's serials can be
// tens of thousands, are read only while the panel is open, and are paged.

export const serialKeys = {
  all: ["product-serials"] as const,
  /** Prefix per model, so adding to one model does not refetch another's. */
  model: (modelId: string) => ["product-serials", modelId] as const,
  page: (modelId: string, params: ListParams) =>
    ["product-serials", modelId, params] as const,
};

export function useModelSerials(modelId: string | null, params: ListParams) {
  return useQuery({
    queryKey: serialKeys.page(modelId ?? "", params),
    queryFn: () => listSerials(modelId as string, params),
    // Only while the panel is open, and only once the model exists — on the
    // Add path there is no id to load until the product has been saved.
    enabled: !!modelId,
    placeholderData: (previous) => previous,
  });
}

/**
 * Every serial write invalidates that model's serial pages AND the tree.
 *
 * The tree matters because `ModelChip` shows the count, and the count is not
 * decoration: zero is the state in which ticket intake does NOT check this
 * model, so a stale one would tell somebody their catalogue is guarded when it
 * is not.
 */
function useSerialMutation<TVars, TData>(
  modelId: string,
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serialKeys.model(modelId) });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

/**
 * `portal` picks the VENDOR's own-product endpoint instead of the ops one.
 *
 * A flag rather than a second hook, because the panel that calls this is the
 * same component on both screens — the difference is which door it knocks on,
 * not what it does.
 */
export const useAddSerials = (modelId: string, portal = false) =>
  useSerialMutation(
    modelId,
    (serials: string[]) =>
      portal ? addOwnSerials(modelId, serials) : addSerials(modelId, serials),
    "Couldn't add those serial numbers"
  );

export const useDeleteSerial = (modelId: string, portal = false) =>
  useSerialMutation(
    modelId,
    (serialId: string) =>
      portal
        ? deleteOwnSerial(modelId, serialId)
        : deleteSerial(modelId, serialId),
    "Couldn't remove that serial number"
  );

/**
 * Correct one in place. A real update, not a delete plus an add — the row keeps
 * its `createdAt`, so fixing a typo does not restamp when that unit was loaded.
 */
export const useUpdateSerial = (modelId: string, portal = false) =>
  useSerialMutation(
    modelId,
    ({ serialId, serial }: { serialId: string; serial: string }) =>
      portal
        ? updateOwnSerial(modelId, serialId, serial)
        : updateSerial(modelId, serialId, serial),
    "Couldn't update that serial number"
  );

/**
 * The two-pass import. A DRY RUN invalidates nothing — it wrote nothing, and
 * refetching on it would flicker the list for a preview the user may cancel.
 */
export function useImportSerials(modelId: string, portal = false) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't read that file" },
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) =>
      portal
        ? importOwnSerials(modelId, file, { dryRun })
        : importSerials(modelId, file, { dryRun }),
    onSuccess: (report) => {
      if (report.dryRun) return;
      queryClient.invalidateQueries({ queryKey: serialKeys.model(modelId) });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}
