import { useQuery } from "@tanstack/react-query";
import {
  getTechnician,
  listEligibleTechnicians,
  listTechnicians,
} from "@/services/technicians";

export const technicianKeys = {
  all: ["technicians"] as const,
  list: (category?: string) => ["technicians", "list", category ?? "All"] as const,
  eligible: (category?: string) => ["technicians", "eligible", category ?? "any"] as const,
  detail: (id: string) => ["technicians", "detail", id] as const,
};

export function useTechnicians(category?: string) {
  return useQuery({
    queryKey: technicianKeys.list(category),
    queryFn: () => listTechnicians(category),
  });
}

export function useTechnician(id: string) {
  return useQuery({
    queryKey: technicianKeys.detail(id),
    queryFn: () => getTechnician(id),
    enabled: Boolean(id),
  });
}

export function useEligibleTechnicians(category?: string) {
  return useQuery({
    queryKey: technicianKeys.eligible(category),
    queryFn: () => listEligibleTechnicians(category),
  });
}
