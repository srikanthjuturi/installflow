import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { technicianKeys } from "./useTechnicians";
import { useWorkspace } from "./useWorkspace";
import type { HoldingInput, TechnicianRulesInput } from "@/types/technicianRules";

/** One technician's rules, redemption terms and holding trail. */
export function useTechnicianRules(id: string) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: technicianKeys.rules(id),
    queryFn: () => api.rules.get(id),
    enabled: Boolean(id),
    meta: { errorTitle: "Couldn't load this technician's rules" },
  });
}

/**
 * Both writes answer with the fresh rules, so the cache is set from the answer
 * and the rest of the technician slice (the detail, the roster) is invalidated
 * — one prefix, the way every other technician write does it.
 */
function useRulesWrite<V>(
  fn: (v: V) => ReturnType<ReturnType<typeof useWorkspace>["api"]["rules"]["put"]>,
  id: string,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(technicianKeys.rules(id), data);
      void queryClient.invalidateQueries({ queryKey: technicianKeys.all });
    },
  });
}

export function useSaveTechnicianRules(id: string) {
  const { api } = useWorkspace();
  return useRulesWrite(
    (body: TechnicianRulesInput) => api.rules.put({ id, body }),
    id,
    "Couldn't save the rules"
  );
}

export function useSetTechnicianHolding(id: string) {
  const { api } = useWorkspace();
  return useRulesWrite(
    (body: HoldingInput) => api.rules.putHolding({ id, body }),
    id,
    "Couldn't save the holding"
  );
}
