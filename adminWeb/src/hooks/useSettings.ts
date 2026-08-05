import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getRulesConfig,
  inviteUser,
  listUsers,
  saveRulesConfig,
  updateUserAccess,
} from "@/services/settings";

export const settingsKeys = {
  all: ["settings"] as const,
  rules: () => ["settings", "rules"] as const,
  users: () => ["settings", "users"] as const,
};

/**
 * The rules engine. Slow-moving reference data — nothing here changes without
 * someone pressing Save — so it stays fresh far longer than a ticket list.
 */
export function useRulesConfig() {
  return useQuery({
    queryKey: settingsKeys.rules(),
    queryFn: getRulesConfig,
    staleTime: 5 * 60_000,
  });
}

/**
 * Deliberately does NOT invalidate `settingsKeys.rules()`: the service is a
 * mock no-op, so refetching would snap the form back and read as data loss.
 * When the real endpoint lands, add the invalidation here — the component
 * and the page both stay as they are.
 */
export function useSaveRulesConfig() {
  return useMutation({ mutationFn: saveRulesConfig });
}

/** Console users — one row per person who can sign in to the portal. */
export function useUsers() {
  return useQuery({
    queryKey: settingsKeys.users(),
    queryFn: listUsers,
    staleTime: 60_000,
  });
}

/** The invited user lands in the list as "Invited", so the list must refetch. */
export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: inviteUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.users() }),
  });
}

/** Role, scope or status changed — the row is stale until the list refetches. */
export function useUpdateUserAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserAccess,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.users() }),
  });
}
