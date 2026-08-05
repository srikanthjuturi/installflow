import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createCategory,
  createVendor,
  listCategories,
  listVendors,
  updateVendor,
} from "@/services/masters";
import type { ListParams } from "@/types/api";

export const masterKeys = {
  all: ["masters"] as const,
  /** Prefix — invalidating this catches every page and filter combination. */
  vendors: () => ["masters", "vendors"] as const,
  vendorPage: (params: ListParams) => ["masters", "vendors", params] as const,
  categories: () => ["masters", "categories"] as const,
};

/**
 * One page of vendors. The params are part of the key, so every filter and
 * page is cached separately and going back is instant.
 */
export function useVendors(params: ListParams) {
  return useQuery({
    queryKey: masterKeys.vendorPage(params),
    queryFn: () => listVendors(params),
    // Paging must not blank the table: the previous page stays on screen until
    // the next one lands, so the toolbar and row heights never jump.
    placeholderData: keepPreviousData,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: masterKeys.categories(),
    queryFn: listCategories,
  });
}

/**
 * Master data is only ever changed from these screens, so a mutation
 * invalidates just its own list — no ticket or dashboard count moves when a
 * vendor is onboarded or a category is added.
 */
function useVendorMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: masterKeys.vendors() });
    },
  });
}

export const useCreateVendor = () => useVendorMutation(createVendor);
export const useUpdateVendor = () => useVendorMutation(updateVendor);

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: masterKeys.categories() });
    },
  });
}
