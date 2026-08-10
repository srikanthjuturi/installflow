import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  cancelInvite,
  createInvite,
  listInvites,
  resendInvite,
} from "@/services/partners";
import type { ListParams } from "@/types/api";
import type { CreateInviteInput, PartnerType } from "@/types/partner";

export const partnerKeys = {
  all: ["partners"] as const,
  /** Per type — a new freelancer must not blank the franchise table. */
  type: (t: PartnerType) => ["partners", t] as const,
  list: (t: PartnerType, params: ListParams) =>
    ["partners", t, "list", params] as const,
};

export function usePartnerInvites(partnerType: PartnerType, params: ListParams) {
  return useQuery({
    queryKey: partnerKeys.list(partnerType, params),
    queryFn: () => listInvites(partnerType, params),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate(partnerType: PartnerType) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: partnerKeys.type(partnerType) });
}

export function useCreateInvite(partnerType: PartnerType) {
  const invalidate = useInvalidate(partnerType);
  return useMutation({
    meta: { errorTitle: "Couldn't create the invite" },
    mutationFn: (input: CreateInviteInput) => createInvite(input),
    onSuccess: invalidate,
  });
}

export function useResendInvite(partnerType: PartnerType) {
  const invalidate = useInvalidate(partnerType);
  return useMutation({
    meta: { errorTitle: "Couldn't resend the invite" },
    mutationFn: (id: string) => resendInvite(id),
    onSuccess: invalidate,
  });
}

export function useCancelInvite(partnerType: PartnerType) {
  const invalidate = useInvalidate(partnerType);
  return useMutation({
    meta: { errorTitle: "Couldn't cancel the invite" },
    mutationFn: (id: string) => cancelInvite(id),
    onSuccess: invalidate,
  });
}
