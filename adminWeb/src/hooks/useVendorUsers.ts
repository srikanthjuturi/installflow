import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createVendorUser,
  deleteVendorUser,
  listVendorUsers,
  updateVendorUser,
} from "@/services/vendorUsers";
import type { ListParams } from "@/types/api";
import type {
  CreateVendorUserInput,
  UpdateVendorUserInput,
} from "@/types/vendorUser";

export const vendorUserKeys = {
  all: ["vendor-users"] as const,
  list: (params: ListParams) => ["vendor-users", "list", params] as const,
};

export function useVendorUsers(params: ListParams) {
  return useQuery({
    queryKey: vendorUserKeys.list(params),
    queryFn: () => listVendorUsers(params),
    placeholderData: keepPreviousData,
    meta: { errorTitle: "Couldn't load your users" },
  });
}

export function useCreateVendorUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVendorUserInput) => createVendorUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorUserKeys.all }),
    // The password is an argument, never cached: `gcTime: 0` so it does not sit
    // in the mutation cache after the screen has moved on. Same reason
    // `useLogin` does it.
    gcTime: 0,
    meta: { errorTitle: "Couldn't add the user" },
  });
}

export function useUpdateVendorUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { membershipId: string; input: UpdateVendorUserInput }) =>
      updateVendorUser(vars.membershipId, vars.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorUserKeys.all }),
    meta: { errorTitle: "Couldn't update the user" },
  });
}

export function useDeleteVendorUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => deleteVendorUser(membershipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: vendorUserKeys.all }),
    meta: { errorTitle: "Couldn't remove the user" },
  });
}
