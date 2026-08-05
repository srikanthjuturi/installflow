import { DataTable, type Column } from "@/components/shared/DataTable";
import { cn } from "@/lib/utils";
import type { JobHistoryEntry } from "@/services/technicians";

const OUTCOME_CLASS: Record<JobHistoryEntry["outcome"], string> = {
  Closed: "bg-status-closed-bg text-status-closed",
  Cancelled: "bg-status-cancelled-bg text-status-cancelled",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "Aug 3" carries no year, so it is compared as an in-year ordinal —
 * month index × 100 + day, giving 803 for "Aug 3" and 730 for "Jul 30".
 * That orders the four recent jobs correctly; anything unparseable returns
 * `null` and the table sorts it last.
 */
function dayOfYear(date: string): number | null {
  const [month, day] = date.trim().split(/\s+/);
  const index = MONTHS.indexOf(month ?? "");
  const value = Number(day);

  return index < 0 || Number.isNaN(value) ? null : (index + 1) * 100 + value;
}

const columns: Column<JobHistoryEntry>[] = [
  {
    id: "id",
    header: "Ticket",
    cell: (h) => (
      <span className="font-mono text-xs font-semibold text-brand-400">
        {h.id}
      </span>
    ),
  },
  { id: "cat", header: "Category", cell: (h) => h.cat },
  {
    id: "date",
    header: "Date",
    sortValue: (h) => dayOfYear(h.date),
    cell: (h) => h.date,
  },
  {
    id: "outcome",
    header: "Outcome",
    cell: (h) => (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.25 py-0.75 text-[11px] font-semibold whitespace-nowrap",
          OUTCOME_CLASS[h.outcome]
        )}
      >
        {h.outcome}
      </span>
    ),
  },
];

/**
 * Four recent jobs inside the technician profile — a short fixed list, not a
 * workspace, so it carries no search, no filters and no paging.
 *
 * DataTable brings the card chrome with it (`rounded-xl bg-card ring-1`, the
 * same treatment as <Card/>), so wrapping this in a Card again would draw a
 * card inside a card. The heading sits above it instead.
 */
export function JobHistoryTable({
  history,
  isLoading = false,
}: {
  history?: JobHistoryEntry[];
  isLoading?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3.5 text-sm font-semibold">Recent job history</h2>

      <DataTable
        caption="Recent job history — ticket, category, date and outcome"
        data={history}
        columns={columns}
        getRowId={(h) => h.id}
        isLoading={isLoading}
        pagination={false}
        defaultSort={{ columnId: "date", dir: "desc" }}
        minWidth="32.5rem"
        emptyTitle="No recent jobs"
        emptyDescription="Jobs appear here once this technician accepts and closes a ticket."
      />
    </section>
  );
}
