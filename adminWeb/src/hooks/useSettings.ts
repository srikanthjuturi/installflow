import { useMutation, useQuery } from "@tanstack/react-query";
import { getRulesConfig, listUsers, saveRulesConfig } from "@/services/settings";

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
