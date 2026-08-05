import { Link } from "react-router";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import type { Ticket } from "@/types";

const columns: Column<Ticket>[] = [
  {
    id: "ticket",
    header: "Ticket",
    cell: (t) => (
      <>
        <Link
          to={`/tickets/${t.id}`}
          className="font-semibold hover:text-brand-400"
        >
          {t.id}
        </Link>
        <div className="text-xs text-ink-3">{t.vendor}</div>
      </>
    ),
  },
  {
    id: "customer",
    header: "Customer",
    cell: (t) => (
      <>
        <div className="font-medium">{t.customer}</div>
        <div className="text-xs text-ink-3">
          {t.city} · {t.pincode}
        </div>
      </>
    ),
  },
  {
    id: "category",
    header: "Category",
    cell: (t) => (
      <>
        <div>{t.category}</div>
        <div className="max-w-45 truncate text-xs text-ink-3">{t.product}</div>
      </>
    ),
  },
  { id: "slot", header: "Slot", cell: (t) => t.slot },
  { id: "tech", header: "Technician", cell: (t) => t.tech },
  {
    id: "status",
    header: "Status",
    cell: (t) => <StatusBadge status={t.status} />,
  },
  { id: "sla", header: "SLA", cell: (t) => <SlaBadge state={t.sla} /> },
];

interface RecentTicketsProps {
  tickets?: Ticket[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function RecentTickets({
  tickets,
  isLoading,
  error,
  onRetry,
}: RecentTicketsProps) {
  return (
    <section>
      {/* No Card wrapper: DataTable already draws the card, and nesting one
          inside another would double the ring and the radius. */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium">Recent tickets</h2>
        <Link
          to="/tickets"
          className="text-xs font-semibold text-brand-400 hover:text-brand-500"
        >
          Open ticket list →
        </Link>
      </div>

      <DataTable
        caption="The six most recent tickets, with their customer, category, slot, technician and status"
        data={tickets}
        columns={columns}
        getRowId={(t) => t.id}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        // A peek, not a workspace — six rows, no search, no paging. The
        // "Open ticket list →" link is the way to the real thing.
        pagination={false}
        emptyTitle="No tickets yet"
        emptyDescription="New intake will appear here as it arrives."
      />
    </section>
  );
}
