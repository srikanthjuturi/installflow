import {
  keepPreviousData,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import {
  listUpiChanges,
  upiChangesPendingCount,
} from "@/services/franchise";
import { saveBlob } from "@/utils/download";
import { statementFileName } from "@/components/franchise/statements";
import type { ListParams } from "@/types/api";
import { useWorkspace } from "./useWorkspace";
import { BACKSTOP_REFETCH_MS } from "./liveness";

/**
 * The franchise portal's OWN server state — Task 09 §5.3.
 *
 * The reused money screens (technicians, redemptions, pool) keep the STAFF
 * hooks and route through `useWorkspace().api`, so their caches stay where
 * they have always been. The portal-only reads below (the UPI changes queue,
 * the statement download) are the ones with no staff twin, and they get this
 * prefix. The options and pincodes queries live in `useTechnicians.ts` beside
 * their staff twins — that is where the shared form reads them.
 */
export const franchiseKeys = {
  all: ["franchise"] as const,
  /** The whole params object — the status segment and paging all key the cache. */
  upiChanges: (params: ListParams) => ["franchise", "upi-changes", params] as const,
  count: () => ["franchise", "upi-changes", "count"] as const,
  /** Master data — the two pick lists the technician form renders (§5.3). */
  options: () => ["technicians", "options"] as const,
  /**
   * The coverage picker's pages. NOT a `ListParams` — the endpoint takes
   * `search`, `regionId` and `limit` rather than the generic list language, and
   * a wrongly-typed key would let a caller send `page` here as if paging lived
   * in the URL. The whole params object keys the cache, like the lists'.
   */
  pincodes: (params: { search?: string; regionId?: string; limit: number }) =>
    ["franchise", "pincodes", params] as const,
};

/** The UPI changes the technicians are asking about — the queue page's rows. */
export function useUpiChanges(params: ListParams = {}) {
  return useQuery({
    queryKey: franchiseKeys.upiChanges(params),
    queryFn: () => listUpiChanges(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * How many are waiting on this franchisee — the rail badge. `enabled` gates it
 * on the feature, exactly as `useRedemptionsBadge` does for its 403-avoiding
 * reason, and a UPI decision (staff or portal) invalidates it.
 */
export function useUpiChangesBadge({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: franchiseKeys.count(),
    queryFn: upiChangesPendingCount,
    staleTime: 30_000,
    refetchInterval: BACKSTOP_REFETCH_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/**
 * Fetch one employee's month and hand it to the browser under the console's
 * own name — the server's `Content-Disposition` is not CORS-exposed, so
 * `statementFileName` names it here instead (see
 * `components/franchise/statements.ts`).
 *
 * §5.10 — WHICH endpoint answers is the workspace's: the portal's Employee
 * statements page rides `/franchise/statements`, the staff profile's
 * Download statement card (Task 06) rides the home-only
 * `/ledger/statements`. The rest of the call is shared, so the naming — the
 * file's shape and the mutation's error title — cannot drift between the two
 * screens that share it.
 *
 * Success toast is the caller's: it knows the name and month on screen and the
 * wording belongs to that screen, not to transport.
 */
export function useStatementDownload() {
  const { api } = useWorkspace();
  return useMutation({
    meta: { errorTitle: "Couldn't download the statement" },
    mutationFn: async (input: {
      technicianId: string;
      code: string;
      month: string;
      company: string;
      franchisee: string;
    }) => {
      const blob = await api.statements.download({
        technicianId: input.technicianId,
        month: input.month,
      });
      saveBlob(
        blob,
        statementFileName({
          company: input.company,
          franchisee: input.franchisee,
          code: input.code,
          month: input.month,
        })
      );
      return input;
    },
  });
}