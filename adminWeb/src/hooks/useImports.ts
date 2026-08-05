import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBatch, uploadBatch } from "@/services/imports";
import { dashboardKeys } from "./useDashboard";
import { ticketKeys } from "./useTickets";

export const importKeys = {
  all: ["imports"] as const,
  batch: (id: string) => ["imports", "batch", id] as const,
};

export function useUploadBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadBatch,
    onSuccess: () => {
      // Passed rows became tickets, so every list and the counts are stale.
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useBatch(id: string) {
  return useQuery({
    queryKey: importKeys.batch(id),
    queryFn: () => getBatch(id),
    enabled: Boolean(id),
  });
}
