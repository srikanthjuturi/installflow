import { BadgeIndianRupee } from "lucide-react";
import { useNavigate } from "react-router";
import { RechargeBadge } from "@/components/credits/RechargeBadge";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { relativeTime } from "@/lib/relativeTime";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  RECHARGE_STATES,
  RECHARGE_STATE_LABELS,
  type RechargeState,
} from "@/types/credits";
import type { PlatformRecharge } from "@/types/platform";
import { moneyPaise } from "@/utils/money";

/**
 * Every company's recharges. A row opens the recharge, where the proof is and
 * where it is confirmed or rejected — nothing is decided in the table itself,
 * because deciding means reading the screenshot against the bank statement.
 */
export function PlatformRechargeTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
}: {
  rows?: PlatformRecharge[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const write = useParamsWriter(params, onParams);
  const origin = useNavOrigin("Back to recharges");

  const columns: Column<PlatformRecharge>[] = [
    {
      id: "company",
      header: "Company",
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.companyName}</div>
          <div className="font-mono text-xs text-ink-3">{r.code}</div>
        </div>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      cell: (r) => moneyPaise(r.amountPaise),
    },
    {
      id: "utr",
      header: "UTR",
      cellClassName: "font-mono text-xs text-ink-2",
      cell: (r) => r.utr ?? "—",
    },
    {
      id: "when",
      header: "When",
      cell: (r) => relativeTime(r.claimedAt ?? r.requestedAt),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <RechargeBadge state={r.state} />,
    },
  ];

  const filters: TypedFilterDef<PlatformRecharge>[] = [
    {
      id: "state",
      label: "Status",
      variant: "pills",
      allLabel: "All",
      options: RECHARGE_STATES.map((s) => ({
        value: s,
        label: RECHARGE_STATE_LABELS[s],
      })),
      value: filterValue(params, "state"),
      onChange: (v) => write((p) => withFilter(p, "state", v)),
      match: (r, value) => r.state === (value as RechargeState),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load recharges"
      caption="Recharges companies have asked for and paid, with the amount, the UTR, when and where each stands"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search company, reference or UTR…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      onRowClick={(r) => navigate(`/recharges/${r.id}`, { state: origin })}
      minWidth="48rem"
      emptyIcon={BadgeIndianRupee}
      emptyTitle="No recharges yet"
      emptyDescription="Recharges companies start appear here."
      filteredEmptyTitle="No recharges match"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
