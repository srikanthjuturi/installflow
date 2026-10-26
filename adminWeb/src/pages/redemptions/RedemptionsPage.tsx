import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Building2 } from "lucide-react";
import {
  FranchiseePicker,
  FRANCHISEE_PARAM,
} from "@/components/shared/FranchiseePicker";
import { Notice } from "@/components/shared/Notice";
import { PageMeta } from "@/components/shared/PageMeta";
import { RedemptionTable } from "@/components/redemptions/RedemptionTable";
import { Card, CardContent } from "@/components/ui/card";
import { useFeatureAccess } from "@/hooks/useAuth";
import { useFranchiseeOptions } from "@/hooks/useFranchisees";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useUrlSeededListParams } from "@/hooks/useListParams";
import { useRedemptions } from "@/hooks/useRedemptions";

/**
 * Technicians asking to be paid their balance — the payer's queue.
 *
 * Starts EXPLICITLY on "To pay", for the reason `ApprovalsPage` spells out: an
 * implicit default would light the All pill above a list that was only ever
 * the backlog. A URL carrying its own `state` still overrides it, and the bell
 * that brings a payer here points straight at one redemption anyway.
 *
 * Task 09 §5.10 — one redemption pool per franchisee (F8), so staff holding
 * `franchisees.view` (Admin and National Head only — that key's own seed set)
 * get a Franchisee selector above everything, defaulting to home. The
 * selection lives in `?franchiseeId=` like the pool screen's does, so a
 * narrowed queue is a link somebody can paste; the row's own `canAct` then
 * decides whether its payment is this payer's to act on.
 */
export default function RedemptionsPage() {
  const [params, setParams] = useUrlSeededListParams(
    { filters: { state: "to_pay" } },
    ["state"]
  );

  // The selection is the POOL, kept one step out of the table-owned filters
  // for the same reason the pool screen keeps it in the query string: the
  // status pills and the search box belong to the table, whose state machinery
  // re-seeds and would clobber a filter the URL owns. Absent is home, which
  // the server resolves; the client never passes home's UUID "just in case".
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = searchParams.get(FRANCHISEE_PARAM);

  // Overriding — not spreading — the URL's key back into the filters: the
  // table's writers see the SCOPED params, so a pill change can carry the key
  // into the state, and a picker change back to home must remove it there too
  // or the queue would stay scoped while the control said home.
  const scopedParams = useMemo(() => {
    const filters = { ...params.filters };
    if (selection) filters[FRANCHISEE_PARAM] = selection;
    else delete filters[FRANCHISEE_PARAM];
    const next: typeof params = { ...params, filters };
    if (Object.keys(filters).length === 0) delete next.filters;
    return next;
  }, [params, selection]);

  const { workspace } = useWorkspace();
  const { has } = useFeatureAccess();
  // Only the staff Admin/NH ever names a pool here — the portal door pins the
  // principal's own, so there is nothing to pick.
  const canPick = workspace === "ops" && has("franchisees.view");
  const options = useFranchiseeOptions({ enabled: canPick });

  // The picker writes the URL; the query reads it straight away through
  // `selection`. One source of truth, zero render-order races.
  const pickFranchisee = (id: string | null) => {
    const url = new URLSearchParams(searchParams);
    if (id) url.set(FRANCHISEE_PARAM, id);
    else url.delete(FRANCHISEE_PARAM);
    setSearchParams(url, { replace: true });
    // A different pool is a different queue — page 4 of the old one means
    // nothing in the new one.
    setParams((p) => ({ ...p, page: 1 }));
  };

  // Whose queue is on screen, for the name the read-only state says.
  const selectedName = !selection
    ? null
    : (options.data?.find((o) => o.id === selection && !o.isHome)?.name ?? null);

  const { data, isLoading, isFetching, isError, error, refetch } =
    useRedemptions(scopedParams);

  return (
    <>
      <PageMeta
        title="Redemptions"
        description="Pay technicians their redeemed balance by UPI"
      />
      <h2 className="sr-only">Redemptions</h2>

      {canPick ? (
        <Card className="mb-3.5">
          <CardContent className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3">
            <FranchiseePicker
              options={options.data}
              value={selection}
              onChange={pickFranchisee}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* §5.10 PROPOSED copy, used as given — the same banner the pool screen
          carries, in the queue's own terms. A home selection (or a portal or
          non-picker session) has nothing to explain. */}
      {canPick && selectedName ? (
        <div className="mb-3.5">
          <Notice
            tone="warn"
            icon={Building2}
            title={`Managed by ${selectedName}.`}
          >
            Its own franchisee admin pays this one; you can read it. No Mark as
            paid, no Decline.
          </Notice>
        </div>
      ) : null}

      <RedemptionTable
        rows={data?.rows}
        meta={data?.pagination}
        params={scopedParams}
        onParams={setParams}
        isLoading={isLoading}
        isFetching={isFetching && !isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
      />
    </>
  );
}