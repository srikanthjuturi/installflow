import { PageMeta } from "@/components/shared/PageMeta";
import { UpiChangeTable } from "@/components/franchise/UpiChangeTable";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { useUpiChanges } from "@/hooks/useFranchise";

/**
 * UPI changes — the queue of payout-destination asks (§5.6).
 *
 * Starts explicitly on PENDING, the way the redemptions queue starts on To
 * pay: the page's one job is the decisions waiting, and the decided ones are a
 * click of the status filter away. A shareable URL still carries
 * `?state=approved` — the seeded-list hook reads it — so a notification that
 * names an approved change can link to it in place.
 */
export default function FranchiseUpiChangesPage() {
  const [params, setParams] = useUrlSeededListParams(
    { filters: { state: "pending" } },
    ["state"]
  );

  const ucd = useUpiChanges(params);

  return (
    <>
      <PageMeta
        title="UPI changes"
        description="Technicians asking to be paid somewhere new"
      />

      <UpiChangeTable
        rows={ucd.data?.rows}
        meta={ucd.data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={ucd.isLoading}
        // A refetch dims the rows; keepPreviousData means the table never
        // blanks, so this signal is the only thing that shows a slow page.
        isFetching={ucd.isFetching && !ucd.isLoading}
        error={ucd.isError ? ucd.error : null}
        onRetry={() => ucd.refetch()}
      />
    </>
  );
}