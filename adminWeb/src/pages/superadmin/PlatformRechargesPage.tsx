import { PlatformRechargeTable } from "@/components/superadmin/PlatformRechargeTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { usePlatformRecharges } from "@/hooks/usePlatform";

/**
 * Companies paying for credits — the superadmin's queue.
 *
 * Starts EXPLICITLY on "Waiting", for the reason `RedemptionsPage` gives: the
 * backlog is what somebody opens this for, and an implicit default would light
 * the All pill above it. Waiting reads oldest first; everything else newest.
 */
export default function PlatformRechargesPage() {
  const [params, setParams] = useUrlSeededListParams(
    { filters: { state: "waiting" } },
    ["state"]
  );
  const { data, isLoading, isFetching, isError, error, refetch } =
    usePlatformRecharges(params);

  return (
    <>
      <PageMeta title="Recharges" description="Confirm companies' credit recharges." />

      <div className="mb-4">
        <h1 className="text-lg font-semibold text-ink">Recharges</h1>
        <p className="text-[13px] text-ink-2">
          Check each payment against your UPI account, then confirm or reject it.
        </p>
      </div>

      <PlatformRechargeTable
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
