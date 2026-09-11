import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  approveBrand,
  approveProduct,
  listApprovals,
  listBrandApprovals,
  pendingApprovalCount,
  rejectBrand,
  rejectProduct,
} from "@/services/approvals";
import type { ListParams } from "@/types/api";
import { productKeys } from "./useProductMaster";
import { vendorKeys } from "./useVendors";
import { BACKSTOP_REFETCH_MS } from "./liveness";

/**
 * Brands sit under the same prefix as products on purpose: the rail badge
 * counts both halves, so a decision on either must refetch it, and one
 * `invalidateQueries(approvalKeys.all)` does.
 */
export const approvalKeys = {
  all: ["product-approvals"] as const,
  list: (params: ListParams) => ["product-approvals", "list", params] as const,
  brands: (params: ListParams) =>
    ["product-approvals", "brands", params] as const,
  count: () => ["product-approvals", "count"] as const,
};

/** The two halves' pending totals, for the switch between them. */
const PENDING_ONLY: ListParams = {
  page: 1,
  limit: 1,
  filters: { status: "pending" },
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

/** One page of vendor-added brands, server-paged like the products half. */
export function useBrandApprovals(params: ListParams) {
  return useQuery({
    queryKey: approvalKeys.brands(params),
    queryFn: () => listBrandApprovals(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/**
 * How many of EACH half are waiting — the numbers on the Products | Brands
 * switch. The rail badge is one total, so without these somebody who followed
 * it here could land on an empty Products list with the waiting brand one click
 * away and nothing saying so.
 *
 * A one-row page of each rather than a new endpoint: `totalRecords` is the
 * count, and the server already answers it.
 */
export function usePendingSplit() {
  const products = useQuery({
    queryKey: approvalKeys.list(PENDING_ONLY),
    queryFn: () => listApprovals(PENDING_ONLY),
    staleTime: 10_000,
  });
  const brands = useQuery({
    queryKey: approvalKeys.brands(PENDING_ONLY),
    queryFn: () => listBrandApprovals(PENDING_ONLY),
    staleTime: 10_000,
  });
  return {
    products: products.data?.pagination.totalRecords,
    brands: brands.data?.pagination.totalRecords,
  };
}

/**
 * A brand decision refetches the queue and the rail badge, and the vendors: an
 * approved brand joins the product form's Brand picker (`/vendors/options`) and
 * the Vendors table's Brands column. No product changes, so the catalogue
 * stays cached.
 */
function useBrandDecision<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  errorTitle: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle },
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalKeys.all });
      queryClient.invalidateQueries({ queryKey: vendorKeys.all });
    },
  });
}

export const useApproveBrand = () =>
  useBrandDecision(approveBrand, "Couldn't approve the brand");

export const useRejectBrand = () =>
  useBrandDecision(rejectBrand, "Couldn't reject the brand");
