import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMe } from "@/hooks/useAuth";
import { useSession } from "@/store/session";
import { PORTAL_ROLES } from "@/types/api";
import type { ListParams } from "@/types/api";
import type {
  CreateUserInput,
  Region,
  RoleOption,
  UpdateUserInput,
} from "@/types/user";
import {
  createUser,
  deleteUser,
  listRegions,
  listRoles,
  listUsers,
  reissueUserPassword,
  updateUser,
} from "@/services/companyUsers";

/** Roles whose reach is the whole country — they hand out any region. */
const ALL_INDIA_ROLES = new Set(["superadmin", "admin", "national_head"]);

export const companyUserKeys = {
  all: ["company-users"] as const,
  list: () => ["company-users", "list"] as const,
  page: (params: ListParams) => ["company-users", "list", params] as const,
};

export function useCompanyUsers(params: ListParams) {
  return useQuery({
    queryKey: companyUserKeys.page(params),
    queryFn: () => listUsers(params),
    placeholderData: keepPreviousData,
  });
}

/** The role catalog. Rarely changes, so it is cached for the session. */
export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: listRoles,
    staleTime: 60 * 60_000,
  });
}

/** The regions of India. Reference data — cached like the role catalog. */
export function useRegions() {
  return useQuery({
    queryKey: ["regions"],
    queryFn: listRegions,
    staleTime: 60 * 60_000,
  });
}

/**
 * Regions the signed-in user may hand out: their own, or all five for an
 * all-India role. The server enforces the same rule — this only keeps the
 * dropdown from offering a choice that would be rejected.
 *
 * Reports `isLoading` rather than an empty list, because the two are not the
 * same thing: an empty list while the catalog is still arriving would render
 * selected regions as raw ids and read as "you have no regions".
 */
export function useAssignableRegions(): {
  regions: Region[];
  isLoading: boolean;
  isError: boolean;
} {
  const catalog = useRegions();
  const me = useMe();
  const loading = catalog.isPending || me.isPending;
  const failed = catalog.isError || me.isError;

  if (loading || failed || !catalog.data || !me.data) {
    return { regions: [], isLoading: loading, isError: failed };
  }
  // Fail closed: without a known role, offer nothing rather than everything.
  const role = me.data.role;
  const regions = ALL_INDIA_ROLES.has(role)
    ? catalog.data
    : catalog.data.filter(
        (r) => new Set(me.data.regions.map((x) => x.id)).has(r.id)
      );
  return { regions, isLoading: false, isError: false };
}

/**
 * Roles the signed-in user may assign — strictly below their own rank. The
 * backend enforces the same rule; this only keeps the UI from offering choices
 * that would be rejected. Returns [] until the catalog loads.
 *
 * Three roles are withheld on purpose, all for one reason: this endpoint cannot
 * create the record each of them needs, so offering them would be offering a
 * choice the server refuses.
 *
 *   * **technician** — needs a profile, certifications and coverage. Onboarded
 *     from the Technicians tab.
 *   * **vendor / vendor_user** — need a `vendor_id` on the membership. A vendor
 *     login is created WITH the vendor on the Vendors screen, and a vendor's
 *     own people from the portal. One made here would authenticate, hold
 *     `jobs.create`, and have no vendor to raise a ticket against.
 *
 * The rank filter cannot express any of this: a vendor ranks 6, BELOW every
 * staff role, so an Area Manager "outranks" one and both would sail straight
 * through. `create_user` in the API refuses all three by name for exactly that
 * reason; this list keeps the dropdown honest about it.
 */
const NOT_INVITABLE_HERE: readonly string[] = ["technician", ...PORTAL_ROLES];

export function useAssignableRoles(): RoleOption[] {
  const { data: roles } = useRoles();
  const myRole = useSession((s) => s.backendUser?.role);
  if (!roles || !myRole) return [];
  const myRank = roles.find((r) => r.key === myRole)?.rank ?? -Infinity;
  return roles.filter(
    (r) => r.rank > myRank && !NOT_INVITABLE_HERE.includes(r.key)
  );
}

/** The signed-in user's rank (from the role catalog), or -Infinity if unknown. */
export function useMyRank(): number {
  const { data: roles } = useRoles();
  const myRole = useSession((s) => s.backendUser?.role);
  return roles?.find((r) => r.key === myRole)?.rank ?? -Infinity;
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: companyUserKeys.list() });
    // The territory tree IS the assignments, so changing one changes the other.
    queryClient.invalidateQueries({ queryKey: ["territory"] });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    meta: { errorTitle: "Couldn't add the user" },
    mutationFn: (input: CreateUserInput) => createUser(input),
    onSuccess: invalidate,
    // When the email fails, the reply carries a live credential. Drop the cache
    // entry as soon as it settles so it is not retained in memory or devtools —
    // the same reasoning as `useLogin`.
    gcTime: 0,
  });
}

/**
 * Email a member a fresh temporary password.
 *
 * `gcTime: 0` for the reason `useLogin` has it: on failure the reply carries a
 * live credential, and it must not linger in the mutation cache or devtools.
 * Nothing to invalidate — a password is not on any list.
 */
export function useReissueUserPassword() {
  return useMutation({
    meta: { errorTitle: "Couldn't reset the password" },
    mutationFn: (membershipId: string) => reissueUserPassword(membershipId),
    gcTime: 0,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    meta: { errorTitle: "Couldn't update the user" },
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      updateUser(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    meta: { errorTitle: "Couldn't remove the user" },
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: invalidate,
  });
}
