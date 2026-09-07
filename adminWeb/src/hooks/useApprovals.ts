import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  approveProduct,
  listApprovals,
  pendingApprovalCount,
  rejectProduct,
} from "@/services/approvals";
import type { ListParams } from "@/types/api";
import { productKeys } from "./useProductMaster";
import { BACKSTOP_REFETCH_MS } from "./liveness";

export const approvalKeys = {
  all: ["product-approvals"] as const,
  list: (params: ListParams) => ["product-approvals", "list", params] as const,
  count: () => ["product-approvals", "count"] as const,
};

/**
 * One page of the queue, server-paged.
 *
 * Server paging rather than the infinite list `/escalations` and `/ledger` use,
 * because those are append-forever feeds and this is a queue you CLEAR — it
 * trends to zero. Its siblings are `/vendors` and `/settings/users`, and the
 * rail badge wants `pagination.totalRecords`, which server mode hands over and
 * an infinite query only gives on page one.
 */
export function useApprovals(params: ListParams) {
  return useQuery({
    queryKey: approvalKeys.list(params),
    queryFn: () => listApprovals(params),
    // The previous page stays on screen while the next loads, so paging does
    // not blank the table. `DataTable` dims it via `isFetching`.
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/**
 * How many are waiting. The rail badge, and nothing else.
 *
 * Its own request rather than reusing the queue's, which is what the escalation
 * badge does. That reuse works there because the rail asks for escalations
 * UNNARROWED, so its key hashes identically to the page's first load — one
 * request, two readers. It does not transfer: this page seeds its params from
 * the URL and grows a `search` the moment anybody types, so the rail would
 * either have to hard-code the page's defaults or badge itself with the count
 * of somebody's search. And "how many are waiting" is a TOTAL — a page of
 * twenty rows cannot say there are twenty-three.
 *
 * `enabled` gates it on the feature, the same way `useEscalations` takes one:
 * without it an Area Manager fetches a 403 every two minutes for a badge they
 * cannot see.
 */
export function useApprovalsBadge({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: approvalKeys.count(),
    queryFn: pendingApprovalCount,
    staleTime: 30_000,
    // The socket says nothing about the catalogue — `notification.raised` is
    // the only frame that touches this, and it invalidates the whole key below.
    // This is the floor under that, for the same reason `liveness.ts` gives.
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/**
 * Both decisions invalidate the catalogue as well as the queue.
 *
 * Approving writes two prices onto a product the Categories screen is drawing,
 * and flips a chip from Pending to Approved on every tree that holds it — so a
 * queue-only invalidation would leave `/categories` asserting the old state
 * until its hour-long `staleTime` expired.
 */
function useDecision<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalKeys.all });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export const useApproveProduct = () =>
  useDecision(approveProduct, "Couldn't approve the product");

export const useRejectProduct = () =>
  useDecision(rejectProduct, "Couldn't reject the product");
