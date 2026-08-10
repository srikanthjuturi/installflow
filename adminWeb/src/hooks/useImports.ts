import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getBatch,
  getBatchErrors,
  listBatchRows,
  uploadBatch,
} from "@/services/imports";
import { dashboardKeys } from "./useDashboard";
import { ticketKeys } from "./useTickets";
import type { ListParams } from "@/types/api";

export const importKeys = {
  all: ["imports"] as const,
  batch: (id: string) => ["imports", "batch", id] as const,
  rows: (id: string, params: ListParams) =>
    ["imports", "batch", id, "rows", params] as const,
  errors: (id: string) => ["imports", "batch", id, "errors"] as const,
};

export function useUploadBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't upload the file" },
    mutationFn: uploadBatch,
    onSuccess: () => {
      // Passed rows became tickets, so every list and the counts are stale.
      queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/** The batch summary — filename, size and the three totals. Not its rows. */
export function useBatch(id: string) {
  return useQuery({
    queryKey: importKeys.batch(id),
    queryFn: () => getBatch(id),
    enabled: Boolean(id),
  });
}

/** One server-paged page of the batch's rows. */
export function useBatchRows(id: string, params: ListParams = {}) {
  return useQuery({
    queryKey: importKeys.rows(id, params),
    queryFn: () => listBatchRows(id, params),
    enabled: Boolean(id),
    // Paging a validation result is scanning it — blanking the table between
    // pages would lose the reader's place every time.
    placeholderData: keepPreviousData,
  });
}

/** Every rejected row, for the error report download. */
export function useBatchErrors(id: string) {
  return useQuery({
    queryKey: importKeys.errors(id),
    queryFn: () => getBatchErrors(id),
    enabled: Boolean(id),
  });
}
