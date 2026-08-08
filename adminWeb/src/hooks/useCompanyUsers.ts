import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/store/session";
import type { ListParams } from "@/types/api";
import type { CreateUserInput, RoleOption, UpdateUserInput } from "@/types/user";
import {
  createUser,
  deleteUser,
  listRoles,
  listUsers,
  updateUser,
} from "@/services/companyUsers";

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
  return () =>
    queryClient.invalidateQueries({ queryKey: companyUserKeys.list() });
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
