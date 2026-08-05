import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategory,
  createVendor,
  listCategories,
  listVendors,
  updateVendor,
} from "@/services/masters";

export const masterKeys = {
  all: ["masters"] as const,
  vendors: () => ["masters", "vendors"] as const,
  categories: () => ["masters", "categories"] as const,
};

export function useVendors() {
  return useQuery({ queryKey: masterKeys.vendors(), queryFn: listVendors });
}

export function useCategories() {
  return useQuery({ queryKey: masterKeys.categories(), queryFn: listCategories });
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
