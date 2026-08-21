import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  importGeography,
  listGeoRegions,
  listPincodes,
  listStates,
} from "@/services/geo";
import type { ListParams } from "@/types/api";
import type { GeoState } from "@/types/geo";

export const geoKeys = {
  all: ["geo"] as const,
  regions: () => ["geo", "regions"] as const,
  states: () => ["geo", "states"] as const,
  pincodes: (params: ListParams, filters: object) =>
    ["geo", "pincodes", params, filters] as const,
};

/**
 * Regions with state counts — the superadmin-readable catalog.
 *
 * `useRegions()` in `useCompanyUsers` is the company-side one and 403s for a
 * superadmin, which is why the Geography screen uses this instead.
 */
export function useGeoRegions() {
  return useQuery({
    queryKey: geoKeys.regions(),
    queryFn: listGeoRegions,
    staleTime: 60 * 60_000,
  });
}

/**
 * All 36 states with their region and counts. Reference data that changes only
 * when a superadmin re-imports, so it is cached for the session like the role
 * and region catalogs.
 */
export function useStates() {
  return useQuery({
    queryKey: geoKeys.states(),
    queryFn: listStates,
    staleTime: 60 * 60_000,
  });
}

/**
 * States grouped under their region, in the catalog's own order.
 *
 * Used by the read-only panel a regional head's assigner sees: pick regions,
 * and the states you are handing over are listed. Grouping here rather than in
 * the component keeps the two consumers (that panel and the area-manager
 * picker) reading the same shape.
 */
export function useStatesByRegion(regionIds: string[]): {
  groups: { regionId: string; regionName: string; states: GeoState[] }[];
  total: number;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isPending, isError } = useStates();
  if (isPending || isError || !data) {
    return { groups: [], total: 0, isLoading: isPending, isError };
  }
  const wanted = new Set(regionIds);
  const groups: { regionId: string; regionName: string; states: GeoState[] }[] = [];
  let total = 0;
  for (const state of data) {
    if (!wanted.has(state.regionId)) continue;
    let group = groups.find((g) => g.regionId === state.regionId);
    if (!group) {
      group = { regionId: state.regionId, regionName: state.regionName, states: [] };
      groups.push(group);
    }
    group.states.push(state);
    total += 1;
  }
  return { groups, total, isLoading: false, isError: false };
}

export function usePincodes(
  params: ListParams,
  filters: { stateId?: string; regionId?: string } = {},
  enabled = true
) {
  return useQuery({
    queryKey: geoKeys.pincodes(params, filters),
    queryFn: () => listPincodes(params, filters),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** How many pincodes one page of the picker holds. */
const PINCODE_PAGE = 25;

/**
 * Pincodes for a searchable picker, a page at a time.
 *
 * Infinite rather than a single page because the narrowing is real: "Hyderabad"
 * alone is 57 codes and a bare region is thousands. A first page of 25 with
 * more on scroll keeps the popup instant and still lets somebody reach the one
 * they want without inventing a more specific search.
 */
export function useInfinitePincodes(
  search: string,
  filters: { stateId?: string; regionId?: string } = {},
  enabled = true
) {
  const query = useInfiniteQuery({
    queryKey: ["geo", "pincodes", "infinite", search, filters] as const,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listPincodes(
        { page: pageParam, limit: PINCODE_PAGE, search: search || undefined },
        filters
      ),
    getNextPageParam: (last) =>
      last.pagination.hasNextPage ? last.pagination.page + 1 : undefined,
    enabled,
  });

  return {
    ...query,
    /** Every page flattened — what the picker renders. */
    rows: query.data?.pages.flatMap((p) => p.rows) ?? [],
    total: query.data?.pages[0]?.pagination.totalRecords ?? 0,
  };
}

/**
 * Upload the spreadsheet. A dry run invalidates nothing — it writes nothing —
 * so only a committed import clears the caches, and it clears `territory` too:
 * a state moving region changes who covers what.
 */
export function useImportGeography() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't read that file" },
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) =>
      importGeography(file, { dryRun }),
    onSuccess: (report) => {
      if (report.dryRun) return;
      queryClient.invalidateQueries({ queryKey: geoKeys.all });
      queryClient.invalidateQueries({ queryKey: ["regions"] });
      queryClient.invalidateQueries({ queryKey: ["territory"] });
    },
  });
}
