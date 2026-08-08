import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMe } from "@/hooks/useAuth";
import { useSession } from "@/store/session";
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
 */
export function useAssignableRegions(): Region[] {
  const { data: regions } = useRegions();
  const me = useMe();
  const own = me.data?.regions ?? [];
  const role = me.data?.role;
  if (!regions) return [];
  if (!role || ALL_INDIA_ROLES.has(role)) return regions;
  const mine = new Set(own.map((r) => r.id));
  return regions.filter((r) => mine.has(r.id));
}

/**
 * Roles the signed-in user may assign — strictly below their own rank. The
 * backend enforces the same rule; this only keeps the UI from offering choices
 * that would be rejected. Returns [] until the catalog loads.
 */
export function useAssignableRoles(): RoleOption[] {
  const { data: roles } = useRoles();
  const myRole = useSession((s) => s.backendUser?.role);
  if (!roles || !myRole) return [];
  const myRank = roles.find((r) => r.key === myRole)?.rank ?? -Infinity;
  return roles.filter((r) => r.rank > myRank);
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
    mutationFn: (input: CreateUserInput) => createUser(input),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      updateUser(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: invalidate,
  });
}
