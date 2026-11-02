import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RejectVendorCreditDialog } from "@/components/vendorCredit/RejectVendorCreditDialog";
import {
  useConfirmSettlement,
  useDeclineSettlement,
  useSettlementFranchisees,
  useSettlementSummary,
  useSettlements,
} from "@/hooks/useFranchiseSettlements";
import { filterValue, useUrlSeededListParams } from "@/hooks/useListParams";
import {
  directionLabel,
  type Settlement,
  type SettlementSide,
} from "@/types/franchiseSettlement";
import { moneyPaise } from "@/utils/money";
import { RecordSettlementDialog } from "./RecordSettlementDialog";
import { SettlementTable } from "./SettlementTable";

/**
 * The transfers screen, once, for both doors. `side="staff"` is the company's
 * Admin / National Head (records money sent TO a franchisee, confirms money a
 * franchisee sent); `side="portal"` is a franchisee's admin (the mirror image).
 *
 * The summary counts CONFIRMED money only, so a transfer nobody has said arrived
 * never moves a figure. Confirm and Decline appear only on rows waiting on the
 * viewer's own side — see `canDecide`.
 */
export function SettlementsView({ side }: { side: SettlementSide }) {
  const staff = side === "staff";
  const [params, setParams] = useUrlSeededListParams({}, [
    "state",
    "direction",
    "franchiseeId",
  ]);
  const franchiseeFilter = staff ? filterValue(params, "franchiseeId") : "All";
  const summaryFranchisee =
    franchiseeFilter !== "All" ? franchiseeFilter : null;

  const list = useSettlements(side, params);
  const summary = useSettlementSummary(side, summaryFranchisee);
  const franchisees = useSettlementFranchisees({ enabled: staff });
  const confirm = useConfirmSettlement(side);
  const decline = useDeclineSettlement(side);

  const [recording, setRecording] = useState(false);
  const [confirming, setConfirming] = useState<Settlement | null>(null);
  const [declining, setDeclining] = useState<Settlement | null>(null);

  const who = staff ? (confirming?.franchiseeName ?? "the franchisee") : "the company";

  return (
    <>
      <PageMeta
        title={staff ? "Franchise settlements" : "Settlements"}
        description="Money sent between the company and its franchisees"
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-ink-2">
          {staff
            ? "Money you send a franchisee is recorded here and counts once they confirm it arrived. Money a franchisee sends you waits for you to confirm."
            : "Money you send the company is recorded here and counts once the company confirms it arrived. Money the company sends you waits for you to confirm."}
        </p>
        <Button type="button" onClick={() => setRecording(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          {staff ? "Record transfer" : "Record transfer to company"}
        </Button>
      </div>

      <SummaryCards
        side={side}
        isLoading={summary.isLoading}
        data={summary.data}
      />

      <SettlementTable
        side={side}
        rows={list.data?.rows}
        meta={list.data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={list.isLoading}
        // A refetch dims the rows; keepPreviousData means the table never
        // blanks, so this signal is the only thing that shows a slow page.
        isFetching={list.isFetching && !list.isLoading}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        franchisees={franchisees.data}
        onConfirm={setConfirming}
        onDecline={setDeclining}
      />

      <RecordSettlementDialog
        side={side}
        open={recording}
        onOpenChange={setRecording}
        franchisees={franchisees.data}
      />

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming ? `Confirm ${confirming.code} arrived?` : "Confirm"}
        description={
          confirming
            ? `Confirm that ${moneyPaise(confirming.amountPaise)} from ${who} reached you. It will count in the totals and a numbered document is issued. This cannot be undone.`
            : ""
        }
        confirmLabel="Yes, it arrived"
        isPending={confirm.isPending}
        onConfirm={() => {
          if (!confirming) return;
          // Closed from `onSuccess` only — a refusal leaves it over the toast.
          confirm.mutate(confirming.id, { onSuccess: () => setConfirming(null) });
        }}
      />

      <RejectVendorCreditDialog
        open={declining !== null}
        onOpenChange={(o) => !o && setDeclining(null)}
        title={declining ? `Decline ${declining.code}?` : "Decline"}
        description={
          declining
            ? `Tell the sender why ${moneyPaise(declining.amountPaise)} did not arrive or did not match. Declining is final — they record a new transfer if it was a mistake.`
            : ""
        }
        placeholder="e.g. Nothing reached our account on that date"
        confirmLabel="Decline transfer"
        isPending={decline.isPending}
        onReject={(reason, onSuccess) => {
          if (!declining) return;
          decline.mutate({ id: declining.id, reason }, { onSuccess });
        }}
      />
    </>
  );
}

function SummaryCards({
  side,
  isLoading,
  data,
}: {
  side: SettlementSide;
  isLoading: boolean;
  data?: {
    companyToFranchiseePaise: number;
    franchiseeToCompanyPaise: number;
    netPaise: number;
    awaitingCount: number;
  };
}) {
  const out = directionLabel("company_to_franchisee", side);
  const inn = directionLabel("franchisee_to_company", side);
  const cards: { label: string; value: number | undefined; hint: string }[] = [
    { label: out, value: data?.companyToFranchiseePaise, hint: "Confirmed only" },
    { label: inn, value: data?.franchiseeToCompanyPaise, hint: "Confirmed only" },
    {
      label: "Net",
      value: data?.netPaise,
      hint:
        side === "staff"
          ? "Positive: you have paid more than you received"
          : "Positive: the company has paid you more than you sent",
    },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-3.5 md:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex flex-col">
            <div className="text-xs font-semibold text-ink-2">{c.label}</div>
            {isLoading ? (
              <Skeleton className="mt-2.5 h-7 w-32" />
            ) : (
              <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
                {moneyPaise(c.value)}
              </div>
            )}
            <div className="mt-1.5 text-xs text-ink-3">{c.hint}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
