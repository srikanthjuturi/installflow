import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getRulesConfig,
  inviteUser,
  listUsers,
  saveRulesConfig,
  updateUserAccess,
} from "@/services/settings";
import type { ListParams } from "@/types/api";

export const settingsKeys = {
  all: ["settings"] as const,
  rules: () => ["settings", "rules"] as const,
  /** Prefix — invalidating this catches every page and filter combination. */
  users: () => ["settings", "users"] as const,
  userPage: (params: ListParams) => ["settings", "users", params] as const,
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
 * The save now writes to the served config, so it invalidates — the screen
 * must re-read what it saved rather than trusting its own draft. Also
 * invalidates the AI queue, which labels rows against this threshold.
 */
export function useSaveRulesConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveRulesConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.rules() });
      queryClient.invalidateQueries({ queryKey: ["ai"] });
    },
  });
}

/**
 * One page of console users — one row per person who can sign in to the
 * portal. The params are part of the key, so every filter and page is cached
 * separately and going back is instant.
 */
export function useUsers(params: ListParams) {
  return useQuery({
    queryKey: settingsKeys.userPage(params),
    queryFn: () => listUsers(params),
    staleTime: 60_000,
    // Paging must not blank the table: the previous page stays on screen until
    // the next one lands.
    placeholderData: keepPreviousData,
  });
}

/** The invited user lands in the list as "Invited", so the list must refetch. */
export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: inviteUser,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.users() }),
  });
}

/** Role, scope or status changed — the row is stale until the list refetches. */
export function useUpdateUserAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserAccess,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.users() }),
  });
}
