import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  importGeography,
  listDistricts,
  listGeoRegions,
  listPincodes,
  listStates,
  lookupPincode,
  type PincodeFilters,
} from "@/services/geo";
import type { ListParams } from "@/types/api";
import type { GeoState } from "@/types/geo";

export const geoKeys = {
  all: ["geo"] as const,
  // `mine` is part of the key: the scoped and unscoped lists are different
  // answers to different questions, and sharing one entry would serve an area
  // manager's single state to a screen that wants all 36.
  regions: (mine = false) => ["geo", "regions", { mine }] as const,
  states: (mine = false) => ["geo", "states", { mine }] as const,
  districts: (filters: object) => ["geo", "districts", filters] as const,
  pincodes: (params: ListParams, filters: object) =>
    ["geo", "pincodes", params, filters] as const,
  pincode: (code: string) => ["geo", "pincode", code] as const,
};

/**
 * Regions with state counts — the superadmin-readable catalog.
 *
 * `useRegions()` in `useCompanyUsers` is the company-side one and 403s for a
 * superadmin, which is why the Geography screen uses this instead.
 */
export function useGeoRegions(mine = false) {
  return useQuery({
    queryKey: geoKeys.regions(mine),
    queryFn: () => listGeoRegions(mine),
    staleTime: 60 * 60_000,
  });
}

/**
 * All 36 states with their region and counts. Reference data that changes only
 * when a superadmin re-imports, so it is cached for the session like the role
 * and region catalogs.
 */
export function useStates(mine = false) {
  return useQuery({
    queryKey: geoKeys.states(mine),
    queryFn: () => listStates(mine),
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

/**
 * The districts of one state (or one region), with their pincode counts.
 *
 * Same session-long cache as the other geo reads — it changes only when a
 * superadmin re-imports. `enabled` is how the drill-down avoids asking for
 * all 754 before a state is chosen.
 */
export function useDistricts(
  filters: { stateId?: string; regionId?: string; mine?: boolean } = {},
  enabled = true
) {
  return useQuery({
    queryKey: geoKeys.districts(filters),
    queryFn: () => listDistricts(filters),
    staleTime: 60 * 60_000,
    enabled,
  });
}

export function usePincodes(
  params: ListParams,
  filters: PincodeFilters = {},
  enabled = true
) {
  return useQuery({
    queryKey: geoKeys.pincodes(params, filters),
    queryFn: () => listPincodes(params, filters),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Six digits — the only shape worth asking the server about. */
const PINCODE_RE = /^\d{6}$/;

/**
 * Is this pincode in the geography master, and what is it?
 *
 * The one query behind "we don't service that pincode". Three outcomes, and
 * they are NOT two:
 *
 *  - `data` is a `GeoPincode` — real, and it carries the authoritative state,
 *    region and districts to fill in;
 *  - `data` is `null` — a real answer: the master does not hold this code;
 *  - `isError` — we could not ask. That must never render as "no service": a
 *    dropped request is our problem, not the customer's address.
 *
 * Cached for the session like the other geo reference reads. A pincode's
 * existence only changes when a superadmin re-imports the master, so asking
 * twice for the same six digits is waste — and forms re-check the same code on
 * every keystroke in the fields around it.
 */
export function usePincodeLookup(code: string) {
  const clean = code.trim();
  return useQuery({
    queryKey: geoKeys.pincode(clean),
    queryFn: () => lookupPincode(clean),
    enabled: PINCODE_RE.test(clean),
    staleTime: 60 * 60_000,
    // The global handler still toasts a genuine failure (hard rule 9), but the
    // field shows its own "couldn't check" note, so the title has to say which
    // request died rather than falling back to a bare status label.
    meta: { errorTitle: "Couldn't check that pincode" },
    // One retry, not three: this runs while somebody is typing, and a slow
    // triple-retry leaves the submit button disabled long after they stopped.
    retry: 1,
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
  filters: PincodeFilters = {},
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
