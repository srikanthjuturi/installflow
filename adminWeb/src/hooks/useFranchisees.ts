import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  activateFranchisee,
  activateFranchiseeAdmin,
  addFranchiseeAdmin,
  createFranchisee,
  deactivateFranchisee,
  deactivateFranchiseeAdmin,
  getFranchisee,
  listFranchiseeAdmins,
  listFranchiseeOptions,
  listFranchisees,
  previewPincodes,
  reissueFranchiseeAdminPassword,
  savePincodes,
  updateFranchisee,
} from "@/services/franchisees";
import type { ListParams } from "@/types/api";
import { technicianKeys } from "./useTechnicians";

export const franchiseeKeys = {
  /** Prefix — invalidating this catches the list, the options, every detail. */
  all: ["franchisees"] as const,
  list: (params: ListParams) => ["franchisees", "list", params] as const,
  options: () => ["franchisees", "options"] as const,
  detail: (id: string) => ["franchisees", "detail", id] as const,
  admins: (id: string) => ["franchisees", "admins", id] as const,
  /** Keyed on the normalised text — `500030 -500040` and `500030-500040` share
   *  one request. A preview is display only; TanStack's key switching is what
   *  keeps a stale reply from ever being rendered. */
  preview: (id: string, ranges: string) =>
    ["franchisees", "preview", id, ranges] as const,
};

/** One page of the list. Params are part of the key, like `useVendors`. */
export function useFranchisees(params: ListParams) {
  return useQuery({
    queryKey: franchiseeKeys.list(params),
    queryFn: () => listFranchisees(params),
    placeholderData: keepPreviousData,
    // A master-data list, not a dispatch surface — a settle time is enough.
    staleTime: 30_000,
  });
}

/**
 * Every franchisee, for the Technicians screen's filter and the home name the
 * dialogs need. Cached five minutes; every franchisee write invalidates it.
 *
 * `enabled` is the caller's business — the Technicians screen passes
 * `has("franchisees.view")` so the screen never fetches a 403 it would toast.
 */
export function useFranchiseeOptions({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: franchiseeKeys.options(),
    queryFn: listFranchiseeOptions,
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useFranchisee(id: string) {
  return useQuery({
    queryKey: franchiseeKeys.detail(id),
    queryFn: () => getFranchisee(id),
    enabled: Boolean(id),
  });
}

export function useFranchiseeAdmins(id: string) {
  return useQuery({
    queryKey: franchiseeKeys.admins(id),
    queryFn: () => listFranchiseeAdmins(id),
    enabled: Boolean(id),
  });
}

/**
 * The carve-out plan for the ranges as typed (already debounced by the caller).
 *
 * A `useQuery`, DELIBERATELY not a mutation. The reply is display only — a
 * plan of what an apply would do — and the key is the locally-valid text, so
 * TanStack's own key switching drops a stale reply for free, which a mutation
 * would have to re-implement by hand. `staleTime: 0` because a plan can age in
 * seconds; `gcTime: 60_000` so a closed dialog does not keep the plan around
 * for the session default.
 */
export function usePincodePreview(
  id: string,
  ranges: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: franchiseeKeys.preview(id, ranges),
    queryFn: () => previewPincodes({ id, pincodeRanges: ranges }),
    enabled: Boolean(id) && enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 60_000,
    meta: { errorTitle: "Couldn't check those pincodes" },
  });
}

/**
 * Every franchisee write invalidates the whole `franchisees` prefix AND the
 * whole `technicians` one: a carve-out or a deactivation moves technicians
 * between franchises, renames one or leaves it, and every technician row carries
 * the franchisee's name. Refreshing only the list would show a team that never
 * moved on the Technicians screen.
 */
function useFranchiseeMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: franchiseeKeys.all });
      queryClient.invalidateQueries({ queryKey: technicianKeys.all });
    },
  });
}

export const useCreateFranchisee = () =>
  useFranchiseeMutation(createFranchisee, "Couldn't add the franchisee");
export const useUpdateFranchisee = () =>
  useFranchiseeMutation(updateFranchisee, "Couldn't save the franchisee");
export const useSavePincodes = () =>
  useFranchiseeMutation(savePincodes, "Couldn't save the pincodes");
export const useDeactivateFranchisee = () =>
  useFranchiseeMutation(
    deactivateFranchisee,
    "Couldn't deactivate the franchisee"
  );
export const useActivateFranchisee = () =>
  useFranchiseeMutation(activateFranchisee, "Couldn't activate the franchisee");

/**
 * Admin writes touch only the one franchisee's people: its admin list and its
 * detail row's `adminCount`. Not the whole `franchisees` prefix — that would
 * refetch the list, the options and every detail over a password email — and
 * not `technicians` either, because a membership's password touches no row.
 */
function useFranchiseeAdminMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      const { franchiseeId } = vars as { franchiseeId: string };
      queryClient.invalidateQueries({ queryKey: franchiseeKeys.admins(franchiseeId) });
      queryClient.invalidateQueries({ queryKey: franchiseeKeys.detail(franchiseeId) });
    },
  });
}

export const useAddFranchiseeAdmin = () =>
  useFranchiseeAdminMutation(addFranchiseeAdmin, "Couldn't add the admin");
export const useDeactivateFranchiseeAdmin = () =>
  useFranchiseeAdminMutation(
    deactivateFranchiseeAdmin,
    "Couldn't deactivate the admin"
  );
export const useActivateFranchiseeAdmin = () =>
  useFranchiseeAdminMutation(
    activateFranchiseeAdmin,
    "Couldn't activate the admin"
  );

/**
 * The reissue. `gcTime: 0` for the reason `useLogin` has it: when the email
 * fails the reply carries a live credential, and it must not sit in the
 * mutation cache or devtools. Nothing else to invalidate — a password is not on
 * any list, and the row's state does not change.
 */
export function useReissueFranchiseeAdminPassword() {
  return useMutation({
    meta: { errorTitle: "Couldn't reset the password" },
    mutationFn: reissueFranchiseeAdminPassword,
    gcTime: 0,
  });
}