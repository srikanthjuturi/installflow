import { Wrench } from "lucide-react";
import { Link, useNavigate } from "react-router";
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
import type { PartRequest } from "@/types/parts";
import { PartStatusBadge } from "./PartStatusBadge";
import { QUEUE_PILLS, partRequestPath } from "./partStatus";

interface PartRequestTableProps {
  rows?: PartRequest[];
  meta?: PaginationMeta;
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * The facility's queue (Task 13 §5.7). Server-paged; the status pills live in
 * `?status=` as a comma-set. *On the desk* is the pills' "no filter" — it sends
 * nothing, and the server answers requested, approved and issued (D22).
 *
 * A row opens the request, where the actions are: deciding happens on the page
 * with the facts in front of the reader, not from a row.
 */
export function PartRequestTable({
  rows,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
}: PartRequestTableProps) {
  const navigate = useNavigate();
  const write = useParamsWriter(params, onParams);
  // Hard rule 11: whoever navigates says where they came from, filters and all.
  const origin = useNavOrigin("Back to spare parts");

  /* No `sortValue`: the server orders a desk itself (requested, approved,
     issued, returned, rejected, then oldest first) and a header arrow would
     reorder nothing. */
  const columns: Column<PartRequest>[] = [
    {
      id: "request",
      header: "Request",
      cell: (r) => (
        // The row is clickable, but the code stays a real link — keyboard
        // reachable, and it carries the origin too (rule 11: both, or one lies).
        <Link
          to={partRequestPath(r.id)}
          state={origin}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs font-semibold text-brand-400"
        >
          {r.code}
        </Link>
      ),
    },
    {
      id: "part",
      header: "Part",
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{r.partName}</span>
          {r.isOther ? (
            <span className="rounded-sm bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
              Other
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "ticket",
      header: "Ticket",
      cell: (r) => (
        <div className="leading-tight">
          <div className="font-mono text-xs text-ink-2">{r.ticketCode}</div>
          <div className="text-xs text-ink-3">{r.productLabel}</div>
        </div>
      ),
    },
    {
      id: "technician",
      header: "Technician",
      cell: (r) => r.technicianName,
    },
    {
      id: "place",
      header: "Place",
      cell: (r) => `${r.city} · ${r.pincode}`,
    },
    {
      id: "raised",
      header: "Raised",
      cell: (r) => relativeTime(r.createdAt),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <PartStatusBadge request={r} />,
    },
  ];

  const filters: TypedFilterDef<PartRequest>[] = [
    {
      id: "status",
      label: "Status",
      variant: "pills",
      allLabel: "On the desk",
      options: QUEUE_PILLS,
      value: filterValue(params, "status"),
      onChange: (v) => write((p) => withFilter(p, "status", v)),
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load part requests"
      caption="Spare-part requests from technicians, with the part, the ticket, the technician, the place, when it was raised and where it stands"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      search={{
        placeholder: "Search by request, ticket, part or technician",
        value: params.search ?? "",
        onChange: (v) => write((p) => withSearch(p, v)),
      }}
      filters={filters}
      server={{ meta, params, onParams }}
      onRowClick={(r) => navigate(partRequestPath(r.id), { state: origin })}
      minWidth="56rem"
      emptyIcon={Wrench}
      emptyTitle="No part requests"
      emptyDescription="Requests technicians raise from a job appear here."
      filteredEmptyTitle="No part requests match"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
