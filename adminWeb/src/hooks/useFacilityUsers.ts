import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { FacilityUserSource } from "@/services/facilityUsers";
import type { ListParams } from "@/types/api";
import type { CreateFacilityUserInput } from "@/types/parts";

/**
 * Facility users — mirrors `useVendorUsers`, over a `FacilityUserSource` so one
 * hook set serves the portal's own door and the staff console's home door.
 *
 * Keys carry the source's `key`, so the two never share a cache entry: the home
 * card on the Franchisees page and a portal table are different people.
 */
export const facilityUserKeys = {
  all: ["facility-users"] as const,
  list: (source: FacilityUserSource, params: ListParams) =>
    ["facility-users", source.key, "list", params] as const,
};

export function useFacilityUsers(
  source: FacilityUserSource,
  params: ListParams,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: facilityUserKeys.list(source, params),
    queryFn: () => source.list(params),
    placeholderData: keepPreviousData,
    enabled,
    meta: { errorTitle: "Couldn't load facility users" },
  });
}

export function useCreateFacilityUser(source: FacilityUserSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFacilityUserInput) => source.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: facilityUserKeys.all }),
    // When the email fails the REPLY carries a live credential; it must not sit
    // in the mutation cache after the screen has moved on (`useLogin`'s reason).
    gcTime: 0,
    meta: { errorTitle: "Couldn't add the user" },
  });
}

export function useSetFacilityUserActive(source: FacilityUserSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { membershipId: string; isActive: boolean }) =>
      source.setActive(vars.membershipId, vars.isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: facilityUserKeys.all }),
    meta: { errorTitle: "Couldn't update the user" },
  });
}

/** `gcTime: 0` for the credential in a failed-email reply, as above. */
export function useReissueFacilityUserPassword(source: FacilityUserSource) {
  return useMutation({
    mutationFn: (membershipId: string) => source.reissuePassword(membershipId),
    gcTime: 0,
    meta: { errorTitle: "Couldn't reset the password" },
  });
}
