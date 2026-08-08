import { useQuery } from "@tanstack/react-query";
import { listTerritory } from "@/services/territory";

export const territoryKeys = {
  all: ["territory"] as const,
  regions: () => ["territory", "regions"] as const,
};

/**
 * The territory tree for the active company. Derived from user assignments, so
 * it is invalidated by the users queries rather than mutated directly.
 */
export function useTerritory() {
  return useQuery({
    queryKey: territoryKeys.regions(),
    queryFn: listTerritory,
    staleTime: 5 * 60_000,
  });
}
