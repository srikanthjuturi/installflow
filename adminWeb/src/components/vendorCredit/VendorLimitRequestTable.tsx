import { TrendingUp } from "lucide-react";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { filterValue, useParamsWriter, withFilter } from "@/hooks/useListParams";
import { relativeTime } from "@/lib/relativeTime";
import type { ListParams, PaginationMeta } from "@/types/api";
import {
  VENDOR_REQUEST_STATUSES,
  VENDOR_REQUEST_STATUS_LABELS,
  type VendorCreditRequest,
  type VendorRequestStatus,
} from "@/types/vendorCredit";
import { moneyPaise } from "@/utils/money";
import { VendorRequestBadge } from "./VendorCreditBadges";

/**
 * Vendors asking for a bigger line. Pending first, longest-waiting within it —
 * the server orders it; this does not re-sort.
 *
 * Only a PENDING row gets buttons, the rule `BrandApprovalTable` follows: a
 * decided row is history, and offering to decide it again is offering a 409.
 */
export function VendorLimitRequestTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
  onApprove,
  onReject,
}: {
  rows?: VendorCreditRequest[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onApprove: (row: VendorCreditRequest) => void;
  onReject: (row: VendorCreditRequest) => void;
}) {
  const write = useParamsWriter(params, onParams);

  const columns: Column<VendorCreditRequest>[] = [
    {
      id: "vendor",
      header: "Vendor",
      sticky: true,
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-medium">{r.vendorName ?? "—"}</div>
          <div className="text-xs text-ink-3">
            {relativeTime(r.submittedAt ?? r.createdAt)}
          </div>
        </div>
      ),
    },
    {
      id: "asked",
      header: "Asked for",
      align: "right",
      cellClassName: "tabular-nums",
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-semibold">{moneyPaise(r.requestedLimitPaise)}</div>
          <div className="text-xs text-ink-3">
            from {moneyPaise(r.currentLimitPaise)}
          </div>
        </div>
      ),
    },
    {
      id: "note",
      header: "Reason given",
      cellClassName: "text-ink-2",
      // An em-dash: a note is optional, and a blank cell reads as a bug.
      cell: (r) => r.note ?? "—",
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: (r) => (
        <div className="flex flex-col items-start gap-1 leading-tight">
          <VendorRequestBadge status={r.status} />
          {r.status === "approved" && r.grantedLimitPaise !== null ? (
            <span className="text-xs text-ink-3">
              Granted {moneyPaise(r.grantedLimitPaise)}
            </span>
          ) : null}
          {r.status === "rejected" && r.rejectReason ? (
            <span className="text-xs text-ink-3">{r.rejectReason}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "actions",
      header: "Decide",
      hideHeader: true,
      cell: (r) =>
        r.status === "pending" ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg border border-input bg-surface px-2.5 text-xs font-semibold text-ink-2 transition-colors hover:border-brand-400 hover:text-ink"
              onClick={() => onReject(r)}
            >
              Reject
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg bg-brand-500 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
              onClick={() => onApprove(r)}
            >
              Approve
            </button>
          </div>
        ) : null,
    },
  ];

  const filters: TypedFilterDef<VendorCreditRequest>[] = [
    {
      id: "status",
      label: "Status",
      variant: "pills",
      allLabel: "All",
      options: VENDOR_REQUEST_STATUSES.map((s) => ({
        value: s,
        label: VENDOR_REQUEST_STATUS_LABELS[s],
      })),
      value: filterValue(params, "status"),
      onChange: (v) => write((p) => withFilter(p, "status", v)),
      match: (r, value) => r.status === (value as VendorRequestStatus),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load credit limit requests"
      caption="Vendors asking for a bigger credit line, what they asked for, and what was decided"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      filters={filters}
      server={{ meta, params, onParams }}
      minWidth="46rem"
      emptyIcon={TrendingUp}
      emptyTitle="No requests"
      emptyDescription="A vendor asking for a bigger credit line appears here."
      filteredEmptyTitle="No requests match"
      filteredEmptyDescription="Try a different status."
    />
  );
}
