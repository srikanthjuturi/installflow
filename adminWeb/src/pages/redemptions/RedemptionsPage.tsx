import { PageMeta } from "@/components/shared/PageMeta";
import { RedemptionTable } from "@/components/redemptions/RedemptionTable";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { useRedemptions } from "@/hooks/useRedemptions";

/**
 * Technicians asking to be paid their balance — the payer's queue.
 *
 * Starts EXPLICITLY on "To pay", for the reason `ApprovalsPage` spells out: an
 * implicit default would light the All pill above a list that was only ever
 * the backlog. A URL carrying its own `state` still overrides it, and the bell
 * that brings a payer here points straight at one redemption anyway.
 */
export default function RedemptionsPage() {
  const [params, setParams] = useUrlSeededListParams(
    { filters: { state: "to_pay" } },
    ["state"]
  );
  const { data, isLoading, isFetching, isError, error, refetch } =
    useRedemptions(params);

  return (
    <>
      <PageMeta
        title="Redemptions"
        description="Pay technicians their redeemed balance by UPI"
      />
      <h2 className="sr-only">Redemptions</h2>
      <RedemptionTable
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
