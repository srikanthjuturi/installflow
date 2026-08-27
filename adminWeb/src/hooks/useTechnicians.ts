import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  cancelInvite,
  createTechnician,
  deleteTechnician,
  getTechnician,
  inviteTechnician,
  listCandidateTechnicians,
  listEligibleTechnicians,
  listTechnicians,
  resendInvite,
  updateTechnician,
} from "@/services/technicians";
import { PRESENCE_REFETCH_MS } from "./liveness";
import type { ListParams } from "@/types/api";

export const technicianKeys = {
  all: ["technicians"] as const,
  /** The whole params object — page, search, sort and filters all key the cache. */
  list: (params: ListParams) => ["technicians", "list", params] as const,
  eligible: (category?: string) =>
    ["technicians", "eligible", category ?? "any"] as const,
  candidates: (subcategoryId: string, pincode: string) =>
    ["technicians", "candidates", subcategoryId, pincode] as const,
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
    // Reachability is the reason this one polls rather than waiting on the
    // socket. A toggle arrives as `technician.changed`; a phone going quiet
    // never does, by design — it decays on a TTL server-side and only a read
    // notices. See PRESENCE_REFETCH_MS.
    refetchInterval: PRESENCE_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useTechnician(id: string) {
  return useQuery({
    queryKey: technicianKeys.detail(id),
    queryFn: () => getTechnician(id),
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
 */
function useTechnicianMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: technicianKeys.all });
    },
  });
}

export const useCreateTechnician = () =>
  useTechnicianMutation(createTechnician, "Couldn't add the technician");
export const useUpdateTechnician = () =>
  useTechnicianMutation(updateTechnician, "Couldn't save the technician");
export const useDeleteTechnician = () =>
  useTechnicianMutation(deleteTechnician, "Couldn't remove the technician");

export const useInviteTechnician = () =>
  useTechnicianMutation(inviteTechnician, "Couldn't create the invite");
export const useResendInvite = () =>
  useTechnicianMutation(resendInvite, "Couldn't resend the invite");
export const useCancelInvite = () =>
  useTechnicianMutation(cancelInvite, "Couldn't cancel the invite");

/** Unpaginated by design — see `listEligibleTechnicians`. */
export function useEligibleTechnicians(category?: string) {
  return useQuery({
    queryKey: technicianKeys.eligible(category),
    queryFn: () => listEligibleTechnicians(category),
  });
}

/**
 * The shortlist for one ticket — real technicians, filtered by the server.
 *
 * Disabled until both halves are known: a query missing the subcategory or the
 * pincode would ask for "every technician", and a manager reading a shortlist
 * has no way to tell that from "everyone here is eligible".
 */
export function useCandidateTechnicians(
  subcategoryId: string | undefined,
  pincode: string | undefined
) {
  return useQuery({
    queryKey: technicianKeys.candidates(subcategoryId ?? "", pincode ?? ""),
    queryFn: () =>
      // Never runs unguarded — `enabled` below is the real check; the
      // fallbacks only satisfy the types.
      listCandidateTechnicians({
        subcategoryId: subcategoryId ?? "",
        pincode: pincode ?? "",
      }),
    enabled: Boolean(subcategoryId && pincode),
  });
}
