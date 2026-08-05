import { useQuery } from "@tanstack/react-query";
import { getDashboard, getRecentTickets } from "@/services/dashboard";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: () => ["dashboard", "summary"] as const,
  recent: () => ["dashboard", "recent"] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: getDashboard,
    // Escalation and AI counts drive action — keep them fresher than lists.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useRecentTickets() {
  return useQuery({
    queryKey: dashboardKeys.recent(),
    queryFn: getRecentTickets,
  });
}
