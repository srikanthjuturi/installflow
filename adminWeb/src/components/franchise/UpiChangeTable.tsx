import { useNavigate } from "react-router";
import { ArrowLeftRight } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import {
  ALL_FILTER,
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { relativeTime } from "@/lib/relativeTime";
import { useWorkspace } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { UpiChangeRow } from "@/types/franchise";
import type { UpiChange } from "@/types/technician";

/**
 * Static class strings — an interpolated tint is never generated (hard rule 6).
 * Tones read the same way `RedemptionBadge`'s do: pending is `warn` because it
 * is the one that is work for the reader, approved is `ok`, rejected is
 * `danger` (this one IS a refusal that happened, not one the reader could
 * still make), and a request the technician withdrew is neutral.
 */
const STATUS_CLASS: Record<
  Exclude<UpiChange["status"], "cancelled">,
  string
> = {
  pending: "bg-warn-bg text-warn",
  approved: "bg-ok-bg text-ok",
  rejected: "bg-danger-bg text-danger",
};
const STATUS_LABEL: Record<StatusKey, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};
type StatusKey = Exclude<UpiChange["status"], "cancelled">;

interface UpiChangeTableProps {
  rows?: UpiChangeRow[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * The franchisee's UPI changes queue — where a payout's destination is asked
 * about. The decision itself happens on the technician's profile (`UpiChangePanel`
 * there), exactly as it does for staff: a row is a pointer to the ask, not the
 * place to approve money rerouting at a glance.
 */
export function UpiChangeTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
}: UpiChangeTableProps) {
  const navigate = useNavigate();
  const write = useParamsWriter(params, onParams);
  // Hard rule 11: whoever navigates says where they came from, filters and all.
  const origin = useNavOrigin("Back to UPI changes");
  const { paths } = useWorkspace();

  /*
   * No `sortValue` anywhere, for the note `ApprovalTable` carries: the server
   * orders this itself — pending oldest first (they have been waiting longest),
   * the decided ones newest first — and a header arrow would reorder nothing.
   */
  const columns: Column<UpiChangeRow>[] = [
    {
      id: "technician",
      header: "Technician",
      // The person first, the code under it — the same treatment every list
      // carrying a `technicianCode` renders, and the person is what the reader
      // matches a face to before they check the code.
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.technicianName}</div>
          <div className="font-mono text-xs text-ink-3">{r.technicianCode}</div>
        </div>
      ),
    },
    {
      id: "upi",
      header: "Current UPI ID",
      cellClassName: "font-mono text-xs text-ink-2",
      cell: (r) => r.oldUpiId,
    },
    {
      id: "asked",
      header: "Asked for",
      // The ID first — it is what pastes into a payer — with the account name
      // under it, which is what a wrong UPI ID is usually caught by.
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-mono text-xs">{r.newUpiId}</div>
          <div className="text-xs text-ink-3">{r.newUpiName}</div>
        </div>
      ),
    },
    {
      id: "requested",
      header: "Requested",
      cell: (r) => relativeTime(r.requestedAt),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) =>
        r.status === "cancelled" ? (
          <span className="rounded-full bg-surface-3 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-ink-2">
            Cancelled
          </span>
        ) : (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
              STATUS_CLASS[r.status]
            )}
          >
            {STATUS_LABEL[r.status]}
          </span>
        ),
    },
  ];

  // A static select: three states plus All. Not pills — four values is
  // already a menu, and the staff twin (`ApprovalTable`) uses a select for the
  // same shape.
  const filters: TypedFilterDef<UpiChangeRow>[] = [
    {
      id: "state",
      label: "Status",
      variant: "select",
      allValue: "All",
      options: [
        { value: "pending", label: "Pending" },
        { value: "approved", label: "Approved" },
        { value: "rejected", label: "Rejected" },
        { value: ALL_FILTER, label: "All" },
      ],
      value: filterValue(params, "state"),
      onChange: (v) => write((p) => withFilter(p, "state", v)),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load UPI changes"
      caption="Technicians asking to change the UPI ID they are paid on"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search technician or UPI ID…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      onRowClick={(r) => navigate(paths.technician(r.technicianId), { state: origin })}
      minWidth="52rem"
      emptyIcon={ArrowLeftRight}
      emptyTitle="No UPI changes waiting"
      emptyDescription="When a technician asks to be paid on a new UPI ID, it appears here."
      filteredEmptyTitle="No changes match that status"
      filteredEmptyDescription="Try a different status."
    />
  );
}