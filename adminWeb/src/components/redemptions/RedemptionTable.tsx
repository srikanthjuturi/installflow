import { IndianRupee } from "lucide-react";
import { useNavigate } from "react-router";
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
import {
  REDEMPTION_STATES,
  REDEMPTION_STATE_LABELS,
  type Redemption,
  type RedemptionState,
} from "@/types/redemption";
import type { ListParams, PaginationMeta } from "@/types/api";
import { moneyPaise } from "@/utils/money";
import { RedemptionBadge } from "./RedemptionBadge";

interface RedemptionTableProps {
  rows?: Redemption[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * The payer's queue. A row opens the redemption, where the QR and the "Mark as
 * paid" form are — nothing is decided in the table itself, because paying
 * happens on a phone and needs the QR in front of the reader.
 */
export function RedemptionTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
}: RedemptionTableProps) {
  const navigate = useNavigate();
  const write = useParamsWriter(params, onParams);
  // Hard rule 11: whoever navigates says where they came from, filters and all.
  const origin = useNavOrigin("Back to redemptions");

  /*
   * No `sortValue` anywhere, for the note `ApprovalTable` carries: the server
   * orders this itself — "to pay" oldest first, the rest newest first — and a
   * header arrow would reorder nothing.
   */
  const columns: Column<Redemption>[] = [
    {
      id: "code",
      header: "Reference",
      cellClassName: "font-mono text-xs",
      cell: (r) => r.code,
    },
    {
      id: "technician",
      header: "Technician",
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.technicianName}</div>
          <div className="font-mono text-xs text-ink-3">{r.technicianCode}</div>
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
      id: "upi",
      header: "UPI ID",
      cellClassName: "font-mono text-xs text-ink-2",
      cell: (r) => r.upiId,
    },
    {
      id: "requested",
      header: "Requested",
      cell: (r) => relativeTime(r.requestedAt),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <RedemptionBadge state={r.state} />,
    },
  ];

  const filters: TypedFilterDef<Redemption>[] = [
    {
      id: "state",
      label: "Status",
      variant: "pills",
      allLabel: "All",
      options: REDEMPTION_STATES.map((s) => ({
        value: s,
        label: REDEMPTION_STATE_LABELS[s],
      })),
      value: filterValue(params, "state"),
      onChange: (v) => write((p) => withFilter(p, "state", v)),
      match: (r, value) => r.state === (value as RedemptionState),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load redemptions"
      caption="Redemptions technicians have asked for, with who asked, how much, the UPI ID it is paid to, when it was requested and where it stands"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search technician, reference or UPI ID…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      onRowClick={(r) => navigate(`/redemptions/${r.id}`, { state: origin })}
      minWidth="56rem"
      emptyIcon={IndianRupee}
      emptyTitle="No redemptions yet"
      emptyDescription="Requests technicians send appear here."
      filteredEmptyTitle="No redemptions match"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
