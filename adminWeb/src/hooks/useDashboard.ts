import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getDashboard,
  getRecentTickets,
  type DashboardFilters,
} from "@/services/dashboard";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: (filters: DashboardFilters = {}) =>
    ["dashboard", "summary", filters] as const,
  recent: (filters: DashboardFilters = {}) =>
    ["dashboard", "recent", filters] as const,
};

export function useDashboard(filters: DashboardFilters = {}) {
  return useQuery({
    queryKey: dashboardKeys.summary(filters),
    queryFn: () => getDashboard(filters),
    // The tiles stay on screen while a new territory or date range loads.
    // Without it every change blanks the page back to skeletons, which on a
    // control people nudge repeatedly reads as the dashboard breaking.
    placeholderData: keepPreviousData,
    // Escalation and AI counts drive action — keep them fresher than lists.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    meta: { errorTitle: "Couldn't load the dashboard" },
  });
}

export function useRecentTickets(filters: DashboardFilters = {}) {
  return useQuery({
    queryKey: dashboardKeys.recent(filters),
    queryFn: () => getRecentTickets(filters),
    placeholderData: keepPreviousData,
    // Its own title: the two queries fail independently, and "Couldn't load the
    // dashboard" over an empty ticket table would send somebody looking at the
    // tiles, which are fine.
    meta: { errorTitle: "Couldn't load recent tickets" },
  });
}
