import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createMapping, listTerritory } from "@/services/territory";

export const territoryKeys = {
  all: ["territory"] as const,
  regions: () => ["territory", "regions"] as const,
};

/** Region → RSH → ASM → serviced pincodes. Master data, so it changes rarely. */
export function useTerritory() {
  return useQuery({
    queryKey: territoryKeys.regions(),
    queryFn: listTerritory,
    staleTime: 5 * 60_000,
  });
}

/** Maps an ASM and their pincodes into a region, creating the region if new. */
export function useCreateMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMapping,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: territoryKeys.all });
    },
  });
}
