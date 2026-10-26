import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteSpeedRule,
  getSpeedCatalogue,
  getTravelRules,
  listSpeedRules,
  saveSpeedRule,
  saveTravelRules,
} from "@/services/allowances";
import type {
  AllowanceScope,
  SpeedRuleInput,
  TravelRules,
} from "@/types/allowances";

/** The id is part of the key for the two staff scopes; the portal's is its own. */
const scopeKey = (s: AllowanceScope) =>
  s.kind === "franchise" ? "franchise" : s.franchiseeId;

export const allowanceKeys = {
  all: ["allowances"] as const,
  travel: (s: AllowanceScope) =>
    ["allowances", "travel", s.kind, scopeKey(s)] as const,
  speed: (s: AllowanceScope) =>
    ["allowances", "speed", s.kind, scopeKey(s)] as const,
  speedCatalogue: ["allowances", "speed", "catalogue"] as const,
};

/**
 * `enabled` exists for the staff screens, which resolve the home franchisee's
 * id asynchronously and would otherwise ask for `/franchisees/undefined/…`.
 */
export function useTravelRules(
  scope: AllowanceScope,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: allowanceKeys.travel(scope),
    queryFn: () => getTravelRules(scope),
    staleTime: 30_000,
    enabled,
    meta: { errorTitle: "Couldn't load the travel rules" },
  });
}

export function useSaveTravelRules(scope: AllowanceScope) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't save the travel rules" },
    mutationFn: (body: TravelRules) => saveTravelRules(scope, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: allowanceKeys.travel(scope) }),
  });
}

export function useSpeedRules(
  scope: AllowanceScope,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: allowanceKeys.speed(scope),
    queryFn: () => listSpeedRules(scope),
    staleTime: 30_000,
    enabled,
    meta: { errorTitle: "Couldn't load the speed rules" },
  });
}

/*
 * Both speed writes invalidate the `["allowances","speed"]` PREFIX, not one
 * key: a rule moves its neighbours' `overriddenBy` / `overridesName` hints, and
 * the catalogue shares the prefix harmlessly.
 */
const SPEED_PREFIX = ["allowances", "speed"] as const;

export function useSaveSpeedRule(scope: AllowanceScope) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't save the rule" },
    mutationFn: (body: SpeedRuleInput) => saveSpeedRule(scope, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: SPEED_PREFIX }),
  });
}

export function useDeleteSpeedRule(scope: AllowanceScope) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't remove the rule" },
    mutationFn: (id: string) => deleteSpeedRule(scope, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SPEED_PREFIX }),
  });
}

/** Franchise principals only — staff pick from `useNodeTree`. Like it, cached an hour. */
export function useSpeedCatalogue({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: allowanceKeys.speedCatalogue,
    queryFn: getSpeedCatalogue,
    staleTime: 60 * 60 * 1000,
    enabled,
    meta: { errorTitle: "Couldn't load categories" },
  });
}
