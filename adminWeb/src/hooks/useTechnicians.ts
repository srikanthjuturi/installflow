import { useMemo } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getDistrictBreakdown,
  listCandidateTechnicians,
} from "@/services/technicians";
import {
  getTechnicianOptions as getFranchiseTechnicianOptions,
  listFranchisePincodes,
} from "@/services/franchise";
import { useWorkspace } from "./useWorkspace";
import { useCertifiableNodeOptions } from "./useProductMaster";
import { useAssignableRegions } from "./useCompanyUsers";
import { useDistricts, useInfinitePincodes } from "./useGeo";
import { useMe } from "./useAuth";
import { franchiseKeys } from "./useFranchise";
import { toNodeOption } from "@/types/franchise";
import { PRESENCE_REFETCH_MS } from "./liveness";
import type { ListParams } from "@/types/api";

export const technicianKeys = {
  all: ["technicians"] as const,
  /** The whole params object — page, search, sort and filters all key the cache. */
  list: (params: ListParams) => ["technicians", "list", params] as const,
  /**
   * The slot is part of the key, not just of the request: two tickets in the
   * same pincode for the same product on DIFFERENT days are two different
   * shortlists, because the capacity column answers a different day for each.
   * Leaving it out would serve one from the other's cache.
   */
  candidates: (subcategoryId: string, pincode: string, onDay?: string | null) =>
    ["technicians", "candidates", subcategoryId, pincode, onDay ?? "today"] as const,
  detail: (id: string) => ["technicians", "detail", id] as const,
  districts: (stateId: string) =>
    ["technicians", "districts", stateId] as const,
  /** Under the prefix, so every technician write — and the bell — refreshes it. */
  upiChange: (id: string) => ["technicians", "upi-change", id] as const,
};

/**
 * The UPI change waiting on this technician, or null.
 *
 * `enabled` is the profile's own `upiChangePending`, so a technician with
 * nothing pending costs no request at all.
 */
export function useUpiChange(id: string, { enabled }: { enabled: boolean }) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: technicianKeys.upiChange(id),
    queryFn: () => api.technicians.getUpiChange(id),
    enabled: Boolean(id) && enabled,
    refetchOnWindowFocus: true,
  });
}

/**
 * Technicians per district for one state, for the territory panel.
 *
 * Under `technicianKeys.all`, so onboarding somebody invalidates this count
 * along with the list — the two are the same population and must not disagree
 * on screen.
 *
 * No presence polling: this counts who COVERS a district, which does not change
 * when a phone goes quiet. The list polls because it shows an online dot.
 */
export function useDistrictBreakdown(stateId: string | undefined) {
  return useQuery({
    queryKey: technicianKeys.districts(stateId ?? ""),
    queryFn: () => getDistrictBreakdown(stateId as string),
    enabled: Boolean(stateId),
    staleTime: 60_000,
  });
}

/**
 * `keepPreviousData` holds the page the reader is looking at on screen while
 * the next one is fetched. Without it every page change, filter and keystroke
 * would blank the table to skeletons and jump the scroll position.
 */
export function useTechnicians(params: ListParams = {}) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: technicianKeys.list(params),
    queryFn: () => api.technicians.list(params),
    placeholderData: keepPreviousData,
    // Reachability is the reason this one polls rather than waiting on the
    // socket. A toggle arrives as `technician.changed`; a phone going quiet
    // never does, by design — it decays on a TTL server-side and only a read
    // notices. See PRESENCE_REFETCH_MS.
    refetchInterval: PRESENCE_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useTechnician(id: string) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: technicianKeys.detail(id),
    queryFn: () => api.technicians.get(id),
    enabled: Boolean(id),
    refetchInterval: PRESENCE_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Every write invalidates the whole `technicians` prefix rather than one key.
 * An invite that completes becomes a technician row, a technician that is
 * removed leaves the eligibility list — the lists are views of one record, so
 * refreshing one and not the others just shows a stale screen.
 *
 * `alsoInvalidate` is for the portals' own state: the UPI decisions change the
 * badge count (`franchiseKeys.count` sits under `franchiseKeys.all`), so those
 * two mutations pass the prefix. Invalidating a prefix no subscriber holds in
 * the other workspace is a no-op, never a fetch.
 */
function useTechnicianMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string,
  alsoInvalidate: readonly (readonly unknown[])[] = []
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: technicianKeys.all });
      for (const key of alsoInvalidate) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export const useCreateTechnician = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (input: Parameters<typeof api.technicians.create>[0]) =>
      api.technicians.create(input),
    "Couldn't add the technician"
  );
};
export const useUpdateTechnician = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (input: Parameters<typeof api.technicians.update>[0]) =>
      api.technicians.update(input),
    "Couldn't save the technician"
  );
};
export const useDeleteTechnician = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (id: string) => api.technicians.remove(id),
    "Couldn't remove the technician"
  );
};

export const useApproveUpiChange = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (id: string) => api.technicians.approveUpiChange(id),
    "Couldn't change the UPI ID",
    [franchiseKeys.all]
  );
};
export const useRejectUpiChange = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (input: { id: string; reason: string }) => api.technicians.rejectUpiChange(input),
    "Couldn't reject the change",
    [franchiseKeys.all]
  );
};

export const useInviteTechnician = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (input: Parameters<typeof api.technicians.invite>[0]) =>
      api.technicians.invite(input),
    "Couldn't create the invite"
  );
};
export const useResendInvite = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (id: string) => api.technicians.resendInvite(id),
    "Couldn't resend the invite"
  );
};
export const useCancelInvite = () => {
  const { api } = useWorkspace();
  return useTechnicianMutation(
    (id: string) => api.technicians.cancelInvite(id),
    "Couldn't cancel the invite"
  );
};

/**
 * "Send app link" on a registered row. A plain mutation, not
 * `useTechnicianMutation`: it changes nothing on the record, so there is no
 * list to refresh — the toast reports the outcome and that is all of it.
 */
export function useSendAppLink() {
  const { api } = useWorkspace();
  return useMutation({
    meta: { errorTitle: "Couldn't send the app link" },
    mutationFn: (id: string) => api.technicians.sendAppLink(id),
  });
}

/**
 * The shortlist for one ticket — real technicians, filtered by the server.
 *
 * Disabled until both halves are known: a query missing the subcategory or the
 * pincode would ask for "every technician", and a manager reading a shortlist
 * has no way to tell that from "everyone here is eligible".
 *
 * `slotStart` is optional and moves only the capacity column — see
 * `listCandidateTechnicians`. Pass the ticket's own slot wherever the answer
 * will be acted on, which is both assignment screens.
 */
export function useCandidateTechnicians(
  subcategoryId: string | undefined,
  pincode: string | undefined,
  slotStart?: string | null
) {
  return useQuery({
    queryKey: technicianKeys.candidates(
      subcategoryId ?? "",
      pincode ?? "",
      slotStart
    ),
    queryFn: () =>
      // Never runs unguarded — `enabled` below is the real check; the
      // fallbacks only satisfy the types.
      listCandidateTechnicians({
        subcategoryId: subcategoryId ?? "",
        pincode: pincode ?? "",
        slotStart,
      }),
    enabled: Boolean(subcategoryId && pincode),
  });
}


/* ═══════════════════════════════════════ Task 09 — workspace-aware pick lists

   The form's and the list's option sources, for a screen that runs under both
   shells. Each hook reads the workspace VALUE the provider handed in and
   enables both underlying queries against their own flag — the React-query
   calls never disappear, only the answers are chosen, which is what keeps
   these rules-of-hooks-proof for a shared component.

   Ops answers are today's queries, byte for byte; the portal answers come from
   the options and pincodes doors of §4.2, whose staff twins live behind
   `masters.view` and staff-only territory reads a franchisee is not granted. */

/** How many pincodes one page of the searchable picker holds — both sides. */
const PICKER_PAGE = 25;

/** Master data: the two pick lists the technician form renders (§4.2). */
export function useTechnicianOptions({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: franchiseKeys.options(),
    queryFn: getFranchiseTechnicianOptions,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** The certification checkbox list, per workspace (§5.3). */
export function useCertifiableSubcategories() {
  const { workspace } = useWorkspace();
  // Each underlying query is enabled on ITS OWN flag — the staff tree is
  // `masters.view`, which a franchise role is deliberately NOT granted (the
  // Task 09 writer decision behind `/franchise/technician-options`), so letting
  // it run in the portal turned every dialog open into a 403 "Not allowed"
  // toast. Both queries stay mounted; only the answers are chosen.
  const ops = workspace === "ops";
  const staff = useCertifiableNodeOptions(ops);
  const portal = useTechnicianOptions({ enabled: workspace === "franchise" });

  // The shape callers see is the same on either side: `{ options, isLoading }`
  // plus the rest of the underlying query, so `TechnicianFormDialog` reads one
  // thing and carries no branch.
  const options = useMemo(
    () => (ops ? staff.options : toNodeOption(portal.data?.subcategories ?? [])),
    [ops, staff.options, portal.data]
  );
  return {
    options,
    isLoading: ops ? staff.isLoading : portal.isLoading,
  };
}

/**
 * The coverage picker's pincodes, searchable and paged — the portal twin of
 * `useGeo.ts::useInfinitePincodes`, against `/franchise/pincodes`, narrowed to
 * the one region selected (the endpoint takes a single one, as the staff
 * read does).
 */
export function useInfiniteFranchisePincodes(
  search: string,
  regionId: string | undefined,
  enabled = true
) {
  const query = useInfiniteQuery({
    queryKey: franchiseKeys.pincodes({
      search: search || undefined,
      regionId: regionId || undefined,
      limit: PICKER_PAGE,
    }),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listFranchisePincodes({
        page: pageParam,
        limit: PICKER_PAGE,
        search: search || undefined,
        regionId: regionId || undefined,
      }),
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
 * The technician list's filter sources: which Region and which Districts.
 *
 * Ops is today's pair — `useAssignableRegions` plus `useDistricts({ mine: 1 })`.
 * The portal holds NO staff territory (`regions` is a staff endpoint, a 403
 * toast on every list open is exactly the noise this work exists to kill), so
 * it reads the options endpoint's regions and offers no districts — every
 * pincode a portal row can carry is already the franchisee's own.
 */
export function useTechnicianFilterOptions() {
  const { workspace } = useWorkspace();
  const staffRegions = useAssignableRegions({ enabled: workspace === "ops" });
  const districts = useDistricts({ mine: true }, workspace === "ops");
  const portalRegions = useTechnicianOptions({ enabled: workspace === "franchise" });

  if (workspace === "ops") {
    return { regions: staffRegions.regions, districts: staffRegions.isLoading ? [] : districts.data ?? [], loading: staffRegions.isLoading };
  }
  return {
    regions: portalRegions.data?.regions ?? [],
    districts: [],
    loading: portalRegions.isLoading,
  };
}

/** `{franchisee}` for the portal's copy — from the `/auth/me` the session keeps. */
export function useFranchiseeName(): string | null {
  const { workspace } = useWorkspace();
  const me = useMe();
  if (workspace !== "franchise") return null;
  return me.data?.franchisee?.name ?? null;
}

/**
 * CoverageFields' two data sources, behind ONE hook (§5.4) — the markup stays
 * untouched and the shell decides where the rows come from.
 *
 * Both branches return the same six things. The portal fills the ops-only
 * flags (`boundedByStates`, `ownStates`) with their no-op values rather than
 * omitting them, so the component carries no workspace branch, and `franchisee`
 * is the portal hint's subject — null on ops, the one new flag it reads.
 */
export function useCoverageOptions(query: string, regionId: string) {
  const { workspace } = useWorkspace();

  const regionsCatalog = useAssignableRegions({ enabled: workspace === "ops" });
  const me = useMe();
  const ownStates = useMemo(
    () => (workspace === "ops" ? (me.data?.states ?? []) : []),
    [workspace, me.data?.states]
  );
  const boundedByStates =
    workspace === "ops" &&
    me.data?.role === "area_manager" &&
    ownStates.length > 0;
  const singleState =
    boundedByStates && ownStates.length === 1 ? ownStates[0].id : undefined;

  const staffSearch = useInfinitePincodes(
    query,
    singleState
      ? { stateId: singleState }
      : { regionId: regionId || undefined },
    workspace === "ops" && Boolean(regionId)
  );
  const portalSearch = useInfiniteFranchisePincodes(
    query,
    regionId || undefined,
    workspace === "franchise" && Boolean(regionId)
  );

  const regions = useTechnicianOptions({ enabled: workspace === "franchise" });

  return workspace === "ops"
    ? {
        workspace,
        regions: regionsCatalog.regions,
        loadingRegions: regionsCatalog.isLoading,
        search: staffSearch,
        boundedByStates,
        ownStates,
        franchisee: null as string | null,
      }
    : {
        workspace,
        regions: regions.data?.regions ?? [],
        loadingRegions: regions.isLoading,
        search: portalSearch,
        boundedByStates: false,
        ownStates,
        franchisee: (me.data?.franchisee?.name ?? null) as string | null,
      };
}
