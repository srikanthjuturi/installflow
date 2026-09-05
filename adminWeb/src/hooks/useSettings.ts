import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  clearNodeRules,
  getNodeRules,
  getRulesConfig,
  inviteUser,
  listUsers,
  saveNodeRules,
  saveRulesConfig,
  updateUserAccess,
} from "@/services/settings";
import type { NodeRuleValues } from "@/services/settings";
import type { ListParams } from "@/types/api";

export const settingsKeys = {
  all: ["settings"] as const,
  rules: () => ["settings", "rules"] as const,
  /** Under the `rules` prefix on purpose: saving the company baseline changes
   *  what every node RESOLVES to, so one invalidation has to catch both. */
  nodeRules: (nodeId: string) => ["settings", "rules", "node", nodeId] as const,
  /** Prefix — invalidating this catches every page and filter combination. */
  users: () => ["settings", "users"] as const,
  userPage: (params: ListParams) => ["settings", "users", params] as const,
};

/**
 * This company's rules — `GET /settings/rules`, a real row in `company_rules`.
 *
 * Slow-moving reference data: nothing changes without somebody pressing Save,
 * so it stays fresh far longer than a ticket list. Read by more than the screen
 * that edits it — the AI queue labels rows against the threshold and the bonus
 * picker draws its chips from the bands — which is why the endpoint admits
 * `jobs.assign` as well as `settings.view`.
 *
 * A vendor holds NEITHER key, and the ticket detail page is shared with the
 * portal — so `enabled` exists to keep the call from being made at all on a
 * surface whose user would only ever be refused. A 403 there is not an error
 * worth a toast; it is a question that should not have been asked.
 */
export function useRulesConfig({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: settingsKeys.rules(),
    queryFn: getRulesConfig,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/**
 * Saves to the database, for this company, permanently.
 *
 * Invalidates rather than writing the response into the cache: the server
 * answers with what is now STORED, and re-reading is what makes a value it
 * adjusted or refused visible instead of assumed.
 *
 * It used to invalidate `["ai"]` as well, so the AI queue would relabel its
 * rows against a new threshold. That line was doing nothing — TanStack matches
 * key SEGMENTS and the queue's keys begin `"ai-review"` — and correcting the
 * key would only have replaced a no-op with a pointless refetch: the queue's
 * rows do not carry the threshold, `useAiThreshold` reads it from the query
 * below, and invalidating that is what actually repaints the labels. Removed
 * rather than fixed.
 */
export function useSaveRulesConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't save the rules" },
    mutationFn: saveRulesConfig,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.rules() }),
  });
}

/**
 * One category's overrides, what it resolves to, and where each value came
 * from — `GET /settings/rules/nodes/{id}`.
 *
 * Three answers in one request because the form needs all three at once: the
 * boxes bind to `own`, the placeholders come from `effective`, and the
 * "from *TV*" hint beside each comes from `inheritedFrom`.
 */
export function useNodeRules(nodeId: string | null) {
  return useQuery({
    queryKey: settingsKeys.nodeRules(nodeId ?? ""),
    queryFn: () => getNodeRules(nodeId!),
    staleTime: 5 * 60_000,
    enabled: Boolean(nodeId),
  });
}

/**
 * Save or clear one category's overrides.
 *
 * Invalidates the whole `rules` prefix, not just this node: a node inherits
 * from its ancestors, so saving one changes what its descendants resolve to —
 * and the tree's "Custom rules" badge lives in a different query again, which
 * is why `product-master` is invalidated too.
 */
export function useSaveNodeRules(nodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't save the category rules" },
    mutationFn: (values: NodeRuleValues | null) =>
      values === null ? clearNodeRules(nodeId) : saveNodeRules(nodeId, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.rules() });
      queryClient.invalidateQueries({ queryKey: ["product-master"] });
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
    meta: { errorTitle: "Couldn't invite the user" },
    mutationFn: inviteUser,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.users() }),
  });
}

/** Role, scope or status changed — the row is stale until the list refetches. */
export function useUpdateUserAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't update access" },
    mutationFn: updateUserAccess,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.users() }),
  });
}
