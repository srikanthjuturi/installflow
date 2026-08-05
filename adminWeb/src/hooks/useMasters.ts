import { useQuery } from "@tanstack/react-query";
import { listCategories, listVendors } from "@/services/masters";

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
