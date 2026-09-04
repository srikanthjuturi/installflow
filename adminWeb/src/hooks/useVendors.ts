import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createVendor,
  reissueVendorPassword,
  deleteVendor,
  listIntakeChannels,
  listVendorOptions,
  listVendors,
  recordAddressSearch,
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

/* The GSTIN registry lookup lives in `hooks/useGstinLookup.ts` — two dialogs in
   different slices use it, and its cache key must stay OUT of the `vendors`
   prefix that every write below invalidates. */

/**
 * Every write invalidates the whole `vendors` prefix rather than the one key it
 * touched: pausing a vendor drops it out of the options list, and renaming one
 * changes the brand shown on every model that carries it.
 *
 * GSTIN lookups are outside that prefix on purpose — see `gstinKeys`.
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

/**
 * Email this vendor's login a fresh temporary password.
 *
 * The way back in for a vendor who never received the first one — and, since
 * `/auth/change-password` needs the current password, the only one.
 *
 * `gcTime: 0`: when the email fails the reply carries a live credential, and it
 * must not sit in the mutation cache. Nothing to invalidate — the vendor row is
 * unchanged, only its login's password is.
 */
export function useReissueVendorPassword() {
  return useMutation({
    meta: { errorTitle: "Couldn't reset the password" },
    mutationFn: (id: string) => reissueVendorPassword(id),
    gcTime: 0,
  });
}
export const useUpdateVendor = () =>
  useVendorMutation(updateVendor, "Couldn't save the vendor");
export const useDeleteVendor = () =>
  useVendorMutation(deleteVendor, "Couldn't remove the vendor");

/**
 * Report one address-search session, and forget about it.
 *
 * A bare `useMutation`, deliberately NOT `useVendorMutation`: that helper
 * invalidates `vendorKeys.all` and the product master, which would make a
 * keystroke in the vendor portal evict console caches and refetch
 * `GET /vendors` — a 403 for the vendor doing the typing.
 *
 * `suppressErrorToast` is mandatory here rather than stylistic. Every other API
 * failure in this console is toasted; a vendor filling in a customer's address
 * must never be interrupted by "Couldn't record the search". The failure is
 * ours, the consequence is one uncounted search, and both are invisible by
 * design — which is why the console's figure is a floor, not an audit.
 *
 * No retry: the session id makes a repeat SAFE, not useful, and a retry storm
 * on a keystroke path buys a number nobody bills on.
 */
export function useRecordAddressSearch() {
  return useMutation({
    mutationFn: (sessionId: string) => recordAddressSearch(sessionId),
    retry: false,
    gcTime: 0,
    meta: { suppressErrorToast: true },
  });
}
