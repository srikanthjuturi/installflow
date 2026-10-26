import { PageMeta } from "@/components/shared/PageMeta";
import { PartRequestTable } from "@/components/parts/PartRequestTable";
import { useListParams } from "@/hooks/useListParams";
import { usePartRequests } from "@/hooks/useParts";

/**
 * The facility's queue — `/franchise/parts` (Task 13 §5.7).
 *
 * Franchise staff only (owner ruling 2026-10-15, R4): there is no staff-console
 * twin of this page, home franchisee included. A home franchise with no facility
 * user has no queue at all; its Admin / National Head give it one from the
 * Franchisees page instead.
 *
 * Starts on *On the desk* — requested, approved and issued, oldest waiting first
 * (Task 12 D22). The page renders no heading of its own: `FranchiseShell` draws
 * the `<h1>` from `franchiseRouteMeta`. Deciding happens on the request page,
 * with the facts in front of the reader, not from a row.
 */
export default function FacilityQueuePage() {
  const [params, setParams] = useListParams();
  const { data, isLoading, isFetching, isError, error, refetch } =
    usePartRequests(params);

  return (
    <>
      <PageMeta title="Spare parts" description="Part requests from technicians" />
      <PartRequestTable
        rows={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        isFetching={isFetching && !isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
      />
    </>
  );
}
