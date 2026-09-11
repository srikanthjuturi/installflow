import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { ApprovalBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  filterValue,
  useParamsWriter,
  withFilter,
  withSearch,
} from "@/hooks/useListParams";
import { relativeTime } from "@/lib/relativeTime";
import { APPROVAL_LABELS, APPROVAL_STATUSES } from "@/types/approval";
import type { ApprovalStatus, BrandSubmission } from "@/types/approval";
import type { ListParams, PaginationMeta } from "@/types/api";

interface BrandApprovalTableProps {
  /** Exactly the rows the server returned for `params` — one page of them. */
  submissions?: BrandSubmission[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onApprove: (submission: BrandSubmission) => void;
  onReject: (submission: BrandSubmission) => void;
}

/**
 * Brands vendors have added from their portal, waiting for a yes.
 *
 * The products table's sibling, and deliberately the same shape — same status
 * pills, same server order (longest wait first, then decided most-recent
 * first), same "only a pending row has buttons" rule. What it lacks is prices:
 * approving a brand only lets the vendor's products carry it.
 */
export function BrandApprovalTable({
  submissions,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  onApprove,
  onReject,
}: BrandApprovalTableProps) {
  const write = useParamsWriter(params, onParams);

  // No `sortValue` on any column, for the reason `ApprovalTable` gives.
  const columns: Column<BrandSubmission>[] = [
    {
      id: "brand",
      header: "Brand",
      cell: (s) => (
        <div className="leading-tight">
          <div className="font-medium">{s.name}</div>
          {/* The reason is why anybody opens the Rejected filter, so it goes on
              the row rather than behind a hover. */}
          {s.approvalStatus === "rejected" && s.rejectionReason ? (
            <div className="mt-0.5 text-xs text-ink-3">{s.rejectionReason}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "vendor",
      header: "Vendor",
      cell: (s) => s.vendorName,
    },
    {
      id: "submitted",
      header: "Submitted",
      cell: (s) => (
        <div className="leading-tight">
          <div>{s.submittedAt ? relativeTime(s.submittedAt) : "—"}</div>
          {s.decidedByName ? (
            <div className="text-xs text-ink-3">by {s.decidedByName}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => <ApprovalBadge status={s.approvalStatus} />,
    },
    {
      id: "manage",
      header: "Manage",
      hideHeader: true,
      align: "right",
      // Only a pending row can be decided — the server 409s anything else.
      cell: (s) =>
        s.approvalStatus === "pending" ? (
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-brand-400"
              onClick={() => onApprove(s)}
            >
              Approve
              <span className="sr-only"> {s.name}</span>
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold text-ink-2"
              onClick={() => onReject(s)}
            >
              Reject
              <span className="sr-only"> {s.name}</span>
            </Button>
          </div>
        ) : null,
    },
  ];

  const filters: TypedFilterDef<BrandSubmission>[] = [
    {
      id: "status",
      label: "Status",
      variant: "pills",
      allLabel: "All",
      options: APPROVAL_STATUSES.map((s) => ({
        value: s,
        label: APPROVAL_LABELS[s],
      })),
      value: filterValue(params, "status"),
      onChange: (v) => write((p) => withFilter(p, "status", v)),
      match: (s, value) => s.approvalStatus === (value as ApprovalStatus),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load brand approvals"
      caption="Brands vendors have added, with the vendor, when each arrived and whether it has been decided"
      data={submissions}
      columns={columns}
      getRowId={(s) => s.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search brand or vendor…",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      minWidth="48rem"
      emptyTitle="Nothing waiting"
      emptyDescription="Brands a vendor adds from its portal appear here. Its products can carry one only once it is approved."
      filteredEmptyTitle="No brands match"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
