import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createPartner,
  listPartners,
  type CreatePartnerInput,
} from "@/services/partners";
import type { ListParams } from "@/types/api";
import type { PartnerKind } from "@/types";

export const partnerKeys = {
  all: ["partners"] as const,
  /** Per kind — a new freelancer must not blank the franchise table. */
  kind: (kind: PartnerKind) => ["partners", kind] as const,
  /** The whole params object — page, search, sort and filters all key the cache. */
  list: (kind: PartnerKind, params: ListParams) =>
    ["partners", kind, "list", params] as const,
};

/**
 * `keepPreviousData` holds the page on screen while the next one is fetched.
 * Without it every page change, filter and keystroke would blank the table to
 * skeletons and jump the scroll position.
 */
export function usePartners(kind: PartnerKind, params: ListParams = {}) {
  return useQuery({
    queryKey: partnerKeys.list(kind, params),
    queryFn: () => listPartners(kind, params),
    placeholderData: keepPreviousData,
  });
}

export function useCreatePartner(kind: PartnerKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePartnerInput) => createPartner(kind, input),
    // By prefix — every page, sort and filter combination of this kind's list.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: partnerKeys.kind(kind) }),
  });
}
