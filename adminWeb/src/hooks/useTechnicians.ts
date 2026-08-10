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
  listEligibleTechnicians,
  listTechnicians,
  resendInvite,
  updateTechnician,
} from "@/services/technicians";
import type { ListParams } from "@/types/api";

export const technicianKeys = {
  all: ["technicians"] as const,
  /** The whole params object — page, search, sort and filters all key the cache. */
  list: (params: ListParams) => ["technicians", "list", params] as const,
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

export function useTechnician(id: string) {
  return useQuery({
    queryKey: technicianKeys.detail(id),
    queryFn: () => getTechnician(id),
    enabled: Boolean(id),
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
