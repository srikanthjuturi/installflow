import { Link, useNavigate } from "react-router";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/utils/datetime";
import type { Ticket } from "@/types/ticket";

/**
 * The day this job happened.
 *
 * The slot, not the intake stamp — a ticket raised on Monday for Friday's
 * window is Friday's job. `createdAt` is only the fallback for a row that has
 * somehow reached a technician without a locked slot; nothing should, since
 * accepting one is what assigns it.
 */
function jobDate(t: Ticket): string {
  return t.slotStart ?? t.createdAt;
}

const columns: Column<Ticket>[] = [
  {
    id: "ticket",
    header: "Ticket",
    cell: (t) => (
      /* The row is clickable, but the code stays a real link so it is
         reachable by keyboard and opens in a new tab. */
      <Link
        to={`/tickets/${t.id}`}
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-xs font-semibold text-brand-400 hover:text-brand-500"
      >
        {t.code}
      </Link>
    ),
  },
  { id: "cat", header: "Category", cell: (t) => t.subcategoryName },
  {
    id: "date",
    header: "Date",
    // Sorted on the instant, rendered as "5 Aug". The two used to be the same
    // string — the mock stored "Aug 3" and this parsed it back into a
    // month-and-day ordinal, which could not tell December from last December.
    sortValue: (t) => Date.parse(jobDate(t)),
    cell: (t) => formatDate(jobDate(t)),
  },
  {
    id: "outcome",
    header: "Outcome",
    // The ticket's real status, in the same badge the ticket list and the
    // dashboard draw. It reads "In Progress" for a job still running: a
    // manager opening this page mid-shift is asking what the technician is on
    // as much as what they finished.
    cell: (t) => <StatusBadge status={t.status} />,
  },
];

/**
 * Recent jobs inside the technician profile — a short fixed list, not a
 * workspace, so it carries no search, no filters and no paging.
 *
 * DataTable brings the card chrome with it (`rounded-xl bg-card ring-1`, the
 * same treatment as <Card/>), so wrapping this in a Card again would draw a
 * card inside a card. The heading sits above it instead.
 */
export function JobHistoryTable({
  jobs,
  isLoading = false,
  error,
  onRetry,
}: {
  jobs?: Ticket[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const navigate = useNavigate();

  return (
    <section>
      <h2 className="mb-3.5 text-sm font-semibold">Recent job history</h2>

      <DataTable
        caption="Recent job history — ticket, category, date and outcome"
        errorTitle="Couldn't load this technician's jobs"
        data={jobs}
        columns={columns}
        getRowId={(t) => t.id}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        onRowClick={(t) => navigate(`/tickets/${t.id}`)}
        pagination={false}
        defaultSort={{ columnId: "date", dir: "desc" }}
        minWidth="32.5rem"
        emptyTitle="No jobs yet"
        emptyDescription="Jobs appear here once this technician accepts a ticket."
      />
    </section>
  );
}
