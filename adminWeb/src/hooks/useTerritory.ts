import { useQuery } from "@tanstack/react-query";
import { listTerritory } from "@/services/territory";

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
