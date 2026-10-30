import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPurchasePlatform,
  deactivatePurchasePlatform,
  listAllPurchasePlatforms,
  listPurchasePlatforms,
  updatePurchasePlatform,
} from "@/services/purchasePlatforms";
import type { PurchasePlatform } from "@/types/purchasePlatform";

export const purchasePlatformKeys = {
  all: ["purchase-platforms"] as const,
  list: () => ["purchase-platforms", "list"] as const,
  /** The management screen's own read — active AND retired. Separate from
   *  `list()` above (which is always `activeOnly=true`, for the raise-a-
   *  ticket picker) so the two can never answer different questions out of
   *  the same cache entry. */
  allList: () => ["purchase-platforms", "all-list"] as const,
};

/**
 * Every active purchase platform, for the raise-a-ticket picker.
 *
 * Cached like `useVendorOptions` beside it on the same form — a short,
 * rarely-changing master every signed-in company role may read.
 */
export function usePurchasePlatforms() {
  return useQuery({
    queryKey: purchasePlatformKeys.list(),
    queryFn: listPurchasePlatforms,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Add a platform from the form's inline "+ Add" — Admin only on the server.
 *
 * Seeds the list cache with the reply rather than invalidating and waiting
 * on a refetch, so the platform just added is selectable at once; a vendor
 * filling in the rest of the form must not see its picker blank while a
 * second request is in flight.
 */
export function useCreatePurchasePlatform() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't add the purchase platform" },
    mutationFn: createPurchasePlatform,
    onSuccess: (platform) => {
      queryClient.setQueryData<PurchasePlatform[]>(
        purchasePlatformKeys.list(),
        (prev) => (prev ? [...prev, platform] : [platform])
      );
      // The management screen's own list is a different cache entry (it
      // reads every platform, not just active ones) — invalidated rather
      // than hand-maintained, since it is a short, rarely-busy screen with
      // nothing waiting on an instant optimistic row the way the ticket
      // picker above does.
      queryClient.invalidateQueries({ queryKey: purchasePlatformKeys.allList() });
    },
  });
}

/**
 * Every platform this company has, active and retired — the management
 * screen's own read. `staleTime` matches the console's default for a list
 * (AGENTS.md → State management), shorter than the picker's hour: this
 * screen is where a platform actually gets added, renamed or retired, so a
 * stale row here is more likely to be wrong.
 */
export function useAllPurchasePlatforms() {
  return useQuery({
    queryKey: purchasePlatformKeys.allList(),
    queryFn: listAllPurchasePlatforms,
    staleTime: 30 * 1000,
  });
}

/**
 * A write to one platform's row (rename, or flip `isActive` directly) or the
 * dedicated deactivate below. Neither reply is the whole list — unlike the
 * vendor-brand mutations beside this file's sibling hooks — so both simply
 * invalidate every purchase-platform query by PREFIX: the picker's
 * `activeOnly` list and this screen's full one both need to agree with
 * whatever the server just decided.
 */
function usePurchasePlatformMutation<TVars>(
  fn: (vars: TVars) => Promise<PurchasePlatform>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchasePlatformKeys.all });
    },
  });
}

/** Rename a platform, or bring a retired one back by sending `isActive: true`. */
export const useUpdatePurchasePlatform = () =>
  usePurchasePlatformMutation(
    updatePurchasePlatform,
    "Couldn't save the purchase platform"
  );

/** Retire a platform. Never a hard delete — see `deactivatePurchasePlatform`. */
export const useDeactivatePurchasePlatform = () =>
  usePurchasePlatformMutation(
    deactivatePurchasePlatform,
    "Couldn't deactivate the purchase platform"
  );
