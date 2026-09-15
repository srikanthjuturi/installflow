import { Wallet } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { filterValue, useParamsWriter, withFilter } from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { relativeTime } from "@/lib/relativeTime";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  RECHARGE_STATES,
  RECHARGE_STATE_LABELS,
  type Recharge,
  type RechargeState,
} from "@/types/credits";
import { moneyPaise } from "@/utils/money";
import { RechargeBadge } from "./RechargeBadge";

/** The company's own recharges. A row opens the recharge, where the QR is. */
export function RechargeTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
}: {
  rows?: Recharge[];
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
  const origin = useNavOrigin("Back to credits");

  const columns: Column<Recharge>[] = [
    {
      id: "code",
      header: "Reference",
      cellClassName: "font-mono text-xs",
      cell: (r) => r.code,
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      cell: (r) => moneyPaise(r.amountPaise),
    },
    {
      id: "requested",
      header: "Requested",
      cell: (r) => (
        <div className="leading-tight">
          <div>{relativeTime(r.requestedAt)}</div>
          {r.requestedBy ? (
            <div className="text-xs text-ink-3">{r.requestedBy}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <RechargeBadge state={r.state} />,
    },
  ];

  const filters: TypedFilterDef<Recharge>[] = [
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
      caption="The company's recharges, with the amount, when and by whom each was asked for, and where it stands"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      filters={filters}
      server={{ meta, params, onParams }}
      onRowClick={(r) => navigate(`/credits/recharges/${r.id}`, { state: origin })}
      minWidth="32rem"
      emptyIcon={Wallet}
      emptyTitle="No recharges yet"
      emptyDescription="Recharges you start appear here."
      filteredEmptyTitle="No recharges match"
      filteredEmptyDescription="Try a different status."
    />
  );
}
