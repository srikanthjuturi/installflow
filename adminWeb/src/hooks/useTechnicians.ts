import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createTechnician,
  getTechnician,
  listEligibleTechnicians,
  listTechnicianCategories,
  listTechnicians,
} from "@/services/technicians";
import type { ListParams } from "@/types/api";

export const technicianKeys = {
  all: ["technicians"] as const,
  /** The whole params object — page, search, sort and filters all key the cache. */
  list: (params: ListParams) => ["technicians", "list", params] as const,
  categories: () => ["technicians", "categories"] as const,
  eligible: (category?: string) =>
    ["technicians", "eligible", category ?? "any"] as const,
  detail: (id: string) => ["technicians", "detail", id] as const,
};

/**
 * `keepPreviousData` holds the page the reader is looking at on screen while
 * the next one is fetched. Without it every page change, filter and keystroke
 * would blank the table to skeletons and jump the scroll position.
 */
export function useTechnicians(params: ListParams = {}) {
  return useQuery({
    queryKey: technicianKeys.list(params),
    queryFn: () => listTechnicians(params),
    placeholderData: keepPreviousData,
  });
}

/**
 * Filter options, faceted server-side — the current page cannot know which
 * categories exist on the pages it is not showing.
 */
export function useTechnicianCategories() {
  return useQuery({
    queryKey: technicianKeys.categories(),
    queryFn: listTechnicianCategories,
    // The master list changes at onboarding pace, not at browsing pace.
    staleTime: 5 * 60_000,
  });
}

export function useTechnician(id: string) {
  return useQuery({
    queryKey: technicianKeys.detail(id),
    queryFn: () => getTechnician(id),
    enabled: Boolean(id),
  });
}

export function useCreateTechnician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTechnician,
    onSuccess: () => {
      // By prefix — every page, sort and filter combination, the category
      // facet, plus the eligibility lists that read from the same master record.
      queryClient.invalidateQueries({ queryKey: technicianKeys.all });
    },
  });
}

/** Unpaginated by design — see `listEligibleTechnicians`. */
export function useEligibleTechnicians(category?: string) {
  return useQuery({
    queryKey: technicianKeys.eligible(category),
    queryFn: () => listEligibleTechnicians(category),
  });
}
