import { Link, useNavigate } from "react-router";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { useNavOrigin, type NavOrigin } from "@/hooks/useNavOrigin";
import { EMPTY, formatSlot } from "@/utils/datetime";
import type { Ticket } from "@/types";

/* Built from the origin rather than at module scope: the ticket link has to
   carry it, or Back from a ticket opened here lands on the board — a list this
   reader chose not to open. */
const buildColumns = (origin?: NavOrigin): Column<Ticket>[] => [
  {
    id: "ticket",
    header: "Ticket",
    cell: (t) => (
      <>
        {/* The row is clickable, but the code stays a real link so it
            is reachable by keyboard and opens in a new tab. */}
        <Link
          to={`/tickets/${t.id}`}
          state={origin}
          onClick={(e) => e.stopPropagation()}
          className="font-semibold hover:text-brand-400"
        >
          {t.code}
        </Link>
        <div className="text-xs text-ink-3">{t.vendorName}</div>
      </>
    ),
  },
  {
    id: "customer",
    header: "Customer",
    cell: (t) => (
      <>
        <div className="font-medium">{t.customerName}</div>
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
        <div>{t.subcategoryName}</div>
        <div className="max-w-45 truncate text-xs text-ink-3">{t.modelName}</div>
      </>
    ),
  },
  {
    id: "slot",
    header: "Slot",
    cell: (t) => formatSlot(t.slotStart, t.slotEnd),
  },
  {
    id: "tech",
    header: "Technician",
    cell: (t) => t.technicianName ?? EMPTY,
  },
  {
    id: "status",
    header: "Status",
    cell: (t) => <StatusBadge status={t.status} />,
  },
  { id: "sla", header: "SLA", cell: (t) => <SlaBadge state={t.slaState} /> },
];


interface RecentTicketsProps {
  tickets?: Ticket[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** The board, still narrowed to whatever the dashboard is showing. */
  ticketsHref: string;
}

export function RecentTickets({
  tickets,
  isLoading,
  error,
  onRetry,
  ticketsHref,
}: RecentTicketsProps) {
  const navigate = useNavigate();
  const origin = useNavOrigin("Back to dashboard");
  const columns = buildColumns(origin);

  return (
    <section>
      {/* No Card wrapper: DataTable already draws the card, and nesting one
          inside another would double the ring and the radius. */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium">Recent tickets</h2>
        <Link
          to={ticketsHref}
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
        onRowClick={(t) => navigate(`/tickets/${t.id}`, { state: origin })}
        // A peek, not a workspace — six rows, no search, no paging. The
        // "Open ticket list →" link is the way to the real thing.
        pagination={false}
        emptyTitle="No tickets yet"
        emptyDescription="New intake will appear here as it arrives."
      />
    </section>
  );
}
