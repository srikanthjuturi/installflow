import { useNavigate } from "react-router";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import type { SlaState, Ticket, TicketStatus } from "@/types";

import { STATUS_CHIPS } from "./statusChips";

/** Breach first — the whole point of the list is triage. */
const SLA_RANK: Record<SlaState, number> = {
  breach: 0,
  warn: 1,
  ok: 2,
  done: 3,
};

interface TicketTableProps {
  tickets?: Ticket[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  toolbarActions?: React.ReactNode;
}

export function TicketTable({
  tickets,
  isLoading,
  error,
  onRetry,
  toolbarActions,
}: TicketTableProps) {
  const navigate = useNavigate();
  // Search and status stay in the query string, so a filtered view can be
  // pasted into a chat and survives back — the table only borrows them.
  const { search, status, setSearch, setStatus } = useTicketFilters();

  const columns: Column<Ticket>[] = [
    {
      id: "ticket",
      header: "Ticket",
      cell: (t) => (
        <>
          {/* The row is clickable, but the id stays a real link so it
              is reachable by keyboard and opens in a new tab. */}
          <a
            href={`/tickets/${t.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs font-semibold text-brand-400"
          >
            {t.id}
          </a>
          <div className="mt-0.5 text-xs text-ink-3">
            {t.vendor} · {t.created}
          </div>
        </>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (t) => (
        <>
          <div className="font-medium">{t.customer}</div>
          <div className="text-xs text-ink-3">{t.mobile}</div>
        </>
      ),
    },
    {
      id: "category",
      header: "Category / Model",
      cell: (t) => (
        <>
          <div>{t.category}</div>
          <div className="max-w-50 truncate text-xs text-ink-3">
            {t.product}
          </div>
        </>
      ),
    },
    { id: "sla", header: "SLA", cell: (t) => t.slaType },
    {
      id: "slot",
      header: "Slot",
      cell: (t) => (
        <>
          <div>{t.slot}</div>
          <div className="text-xs text-ink-3">
            {t.city} · {t.pincode}
          </div>
        </>
      ),
    },
    { id: "tech", header: "Technician", cell: (t) => t.tech },
    {
      id: "status",
      header: "Status",
      cell: (t) => <StatusBadge status={t.status} />,
    },
    {
      id: "slaState",
      header: "SLA state",
      // The cell shows a word; the sort runs on the urgency rank behind it,
      // so the default order is triage order rather than alphabetical.
      sortValue: (t) => SLA_RANK[t.sla],
      cell: (t) => <SlaBadge state={t.sla} />,
    },
  ];

  const filters: TypedFilterDef<Ticket>[] = [
    {
      id: "status",
      label: "Status",
      variant: "pills",
      options: STATUS_CHIPS.map((chip) => ({ value: chip, label: chip })),
      value: status,
      onChange: (v) => setStatus(v as TicketStatus | "All"),
      match: (t, v) => t.status === v,
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
      search={{
        placeholder: "Search by ticket ID, customer, mobile, pincode…",
        value: search,
        onChange: setSearch,
        fn: (t, q) =>
          t.id.toLowerCase().includes(q) ||
          t.customer.toLowerCase().includes(q) ||
          t.mobile.includes(q) ||
          t.pincode.includes(q),
      }}
      filters={filters}
      toolbarActions={toolbarActions}
      defaultSort={{ columnId: "slaState", dir: "asc" }}
      countLabel={(n) => (
        <>
          Showing <b className="text-ink">{n}</b> tickets
        </>
      )}
      summary={
        <>
          Sorted by <b className="text-ink">SLA urgency</b>
        </>
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
