import { useNavigate } from "react-router";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import type { ListParams, PaginationMeta } from "@/types/api";
import { EMPTY, formatDateTime, formatSlot } from "@/utils/datetime";
import type { SlaState, Ticket } from "@/types";

import { STATUS_CHIPS } from "./statusChips";

/** Breach first — the whole point of the list is triage. */
const SLA_RANK: Record<SlaState, number> = {
  breach: 0,
  warn: 1,
  ok: 2,
  done: 3,
};

interface TicketTableProps {
  /** One server page. The table renders these rows and only these rows. */
  tickets?: Ticket[];
  /** The envelope's pagination block — total, page count, where we are. */
  meta?: PaginationMeta;
  /** The request that produced `tickets`. Lives in the URL, owned by the page. */
  params: ListParams;
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
}

export function TicketTable({
  tickets,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
  toolbarActions,
}: TicketTableProps) {
  const navigate = useNavigate();
  const status = params.filters?.status ?? "All";

  // Anything that changes WHICH rows match sends the reader back to page 1 —
  // page 4 of an unfiltered list is not page 4 of the filtered one.
  const narrow = (next: ListParams) => onParams({ ...next, page: 1 });

  const columns: Column<Ticket>[] = [
    {
      id: "ticket",
      header: "Ticket",
      sortValue: (t) => t.code,
      cell: (t) => (
        <>
          {/* The row is clickable, but the code stays a real link so it
              is reachable by keyboard and opens in a new tab. */}
          <a
            href={`/tickets/${t.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs font-semibold text-brand-400"
          >
            {t.code}
          </a>
          <div className="mt-0.5 text-xs text-ink-3">
            {t.vendorName} · {formatDateTime(t.createdAt)}
          </div>
        </>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      sortValue: (t) => t.customerName,
      cell: (t) => (
        <>
          <div className="font-medium">{t.customerName}</div>
          <div className="text-xs text-ink-3">{t.customerPhone}</div>
        </>
      ),
    },
    {
      id: "category",
      header: "Category / Model",
      sortValue: (t) => t.subcategoryName,
      cell: (t) => (
        <>
          <div>{t.subcategoryName}</div>
          <div className="max-w-50 truncate text-xs text-ink-3">
            {t.modelName}
          </div>
        </>
      ),
    },
    {
      id: "serviceType",
      header: "Service type",
      cell: (t) => t.serviceType,
    },
    // "24h" from the number. The hours are what is stored; the suffix is how
    // the prototype writes it.
    { id: "sla", header: "SLA", cell: (t) => `${t.serviceLevelHours}h` },
    {
      id: "slot",
      header: "Slot",
      sortValue: (t) => t.slotStart ?? "",
      cell: (t) => (
        <>
          <div>{formatSlot(t.slotStart, t.slotEnd)}</div>
          <div className="text-xs text-ink-3">
            {t.city} · {t.pincode}
          </div>
        </>
      ),
    },
    // Null until a technician accepts — first-accept-wins.
    {
      id: "tech",
      header: "Technician",
      cell: (t) => t.technicianName ?? EMPTY,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (t) => t.status,
      cell: (t) => <StatusBadge status={t.status} />,
    },
    {
      id: "slaState",
      header: "SLA state",
      // The server sorts this column on the urgency rank behind the word, so
      // the default order is triage order rather than alphabetical. The rank
      // stays here to mark the column sortable and to show the active arrow.
      sortValue: (t) => SLA_RANK[t.slaState],
      cell: (t) => <SlaBadge state={t.slaState} />,
    },
  ];

  const filters: TypedFilterDef<Ticket>[] = [
    {
      id: "status",
      label: "Status",
      variant: "pills",
      options: STATUS_CHIPS.map((chip) => ({ value: chip, label: chip })),
      value: status,
      onChange: (v) =>
        narrow({ ...params, filters: { ...params.filters, status: v } }),
      // Never called in server mode — the backend applies the status filter and
      // the table renders what comes back. `match` is required by the type, so
      // it stands here as the identity it effectively is.
      match: () => true,
    },
  ];

  return (
    <DataTable
      errorTitle="Couldn't load tickets"
      caption="Tickets, with their customer, category, SLA, confirmed slot, technician and status"
      data={tickets}
      columns={columns}
      getRowId={(t) => t.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      // No `fn` or `keys`: the server matches ticket ID, customer, mobile and
      // pincode. Matching again here would search one page of an answer.
      search={{
        placeholder: "Search by ticket ID, customer, mobile, pincode…",
        value: params.search ?? "",
        onChange: (v) => narrow({ ...params, search: v }),
      }}
      filters={filters}
      toolbarActions={toolbarActions}
      server={{ meta, params, onParams }}
      defaultSort={{
        columnId: params.sortBy ?? "slaState",
        dir: params.sortDir ?? "asc",
      }}
      countLabel={(n) => (
        <>
          Showing <b className="text-ink">{n}</b> tickets
        </>
      )}
      summary={
        // Only true while SLA rank is the active sort — asserting it under any
        // other order would be a lie the table itself contradicts.
        (params.sortBy ?? "slaState") === "slaState" ? (
          <>
            Sorted by <b className="text-ink">SLA urgency</b>
          </>
        ) : null
      }
      onRowClick={(t) => navigate(`/tickets/${t.id}`)}
      minWidth="57.5rem"
      emptyTitle="No tickets yet"
      emptyDescription="Intake from API, Excel upload or manual entry will appear here."
      filteredEmptyTitle="No tickets match those filters"
      filteredEmptyDescription="Try a different status, or clear the search."
    />
  );
}
