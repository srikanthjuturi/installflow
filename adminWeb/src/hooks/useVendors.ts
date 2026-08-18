import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createVendor,
  deleteVendor,
  listIntakeChannels,
  listVendorOptions,
  listVendors,
  updateVendor,
} from "@/services/vendors";
import type { ListParams } from "@/types/api";

export const vendorKeys = {
  /** Prefix — invalidating this catches every page, filter and the options. */
  all: ["vendors"] as const,
  list: (params: ListParams) => ["vendors", "list", params] as const,
  options: () => ["vendors", "options"] as const,
  channels: () => ["vendors", "channels"] as const,
};

/**
 * One page of vendors. The params are part of the key, so every filter and page
 * is cached separately and going back is instant.
 */
export function useVendors(params: ListParams) {
  return useQuery({
    queryKey: vendorKeys.list(params),
    queryFn: () => listVendors(params),
    // Paging must not blank the table: the previous page stays on screen until
    // the next lands, so the toolbar and row heights never jump.
    placeholderData: keepPreviousData,
  });
}

/**
 * Every selectable brand, for the product model form's picker.
 *
 * Cached long, like the category tree: the brand list changes a few times a
 * year, and this is fetched every time somebody opens the model dialog.
 */
export function useVendorOptions() {
  return useQuery({
    queryKey: vendorKeys.options(),
    queryFn: listVendorOptions,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * The intake-channel catalogue.
 *
 * Cached for the session — it is code on the server, not data, and only changes
 * when the API push endpoint ships and "API" becomes selectable. `staleTime:
 * Infinity` rather than an hour: nothing a user does can move it.
 */
export function useIntakeChannels() {
  return useQuery({
    queryKey: vendorKeys.channels(),
    queryFn: listIntakeChannels,
    staleTime: Infinity,
  });
}

/**
 * Every write invalidates the whole `vendors` prefix rather than the one key it
 * touched: pausing a vendor drops it out of the options list, and renaming one
 * changes the brand shown on every model that carries it.
 */
function useVendorMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.all });
      // A vendor's name and status are rendered on every product model, so the
      // catalogue tree is stale too.
      queryClient.invalidateQueries({ queryKey: ["product-master"] });
    },
  });
}

export const useCreateVendor = () =>
  useVendorMutation(createVendor, "Couldn't add the vendor");
export const useUpdateVendor = () =>
  useVendorMutation(updateVendor, "Couldn't save the vendor");
export const useDeleteVendor = () =>
  useVendorMutation(deleteVendor, "Couldn't remove the vendor");
