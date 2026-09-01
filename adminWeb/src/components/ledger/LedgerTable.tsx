import { Link } from "react-router";
import { Download } from "lucide-react";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/utils/csv";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { formatTimeOfDay } from "@/utils/datetime";
import { dayLabel } from "@/lib/dayGroup";
import { moneyPaise } from "@/utils/money";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { LedgerEntry } from "@/types";

/**
 * Static class strings, one per kind — an interpolated `bg-${kind}-bg` would
 * never be generated.
 */
const KIND_CHIP: Record<LedgerEntry["kind"], string> = {
  penalty: "bg-danger-bg text-danger",
  bonus: "bg-ok-bg text-ok",
};

/** The wire value is lower case; the column prints the approved label. */
const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  penalty: "Penalty",
  bonus: "Bonus",
};

const ALL = "All";

interface LedgerTableProps {
  /** Every page loaded so far, already filtered and sorted by the server. */
  entries?: LedgerEntry[];
  /** The LAST page's meta — `totalRecords` is the whole filtered ledger. */
  meta?: PaginationMeta;
  params: ListParams;
  /** Merges what it is given into the query — see `applyParams` on the page. */
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  isFetching?: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage: () => void;
  /**
   * When the rows were READ, as an epoch. It is what "Today" on a divider is
   * measured against — `new Date()` here would be an impure call during render
   * and would also drift from the data it is labelling.
   */
  readAt: number;
}

export function LedgerTable({
  entries,
  meta,
  params,
  onParams,
  isLoading,
  isFetching,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  readAt,
}: LedgerTableProps) {
  const kind = params.filters?.kind ?? ALL;
  const now = new Date(readAt);

  /* Both link columns leave the ledger, and both landed on a screen that sent
     the reader to its own list — a technician row to the roster, a ticket row
     to the board. Neither is where they were. The origin keeps the query
     string, so Back also restores the kind filter and the date range. */
  const origin = useNavOrigin("Back to ledger");

  // The rows in hand — which, on an infinite list, is everything scrolled to
  // so far rather than one page.
  const visible = entries ?? [];

  const columns: Column<LedgerEntry>[] = [
    {
      id: "date",
      header: "Time",
      // The TIME only. The date sits on the divider above the run this row
      // belongs to, and repeating "4 Aug" down forty rows under a heading that
      // already says "4 Aug" is the noise the divider exists to remove.
      cell: (l) => formatTimeOfDay(new Date(l.at)),
    },
    {
      id: "kind",
      header: "Type",
      cell: (l) => (
        // The word carries the debit/credit distinction, so the amount's
        // colour is never the only signal.
        <span
          className={cn(
            "inline-block rounded-full px-2.25 py-0.75 text-[11px] font-semibold",
            KIND_CHIP[l.kind]
          )}
        >
          {KIND_LABEL[l.kind]}
        </span>
      ),
    },
    {
      id: "tech",
      header: "Technician",
      cell: (l) => (
        <Link
          to={`/technicians/${l.technicianId}`}
          state={origin}
          className="font-semibold text-brand-400 hover:underline"
        >
          {l.technicianName}
        </Link>
      ),
    },
    {
      id: "ticket",
      header: "Ticket",
      cell: (l) => (
        // The CODE is what a person quotes; the UUID beside it is what the
        // route needs. The mock had only one value and used it for both.
        <Link
          to={`/tickets/${l.ticketId}`}
          state={origin}
          className="font-mono text-xs font-semibold text-brand-400 hover:underline"
        >
          {l.ticketCode}
        </Link>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      cell: (l) => <span className="text-xs text-ink-2">{l.reason}</span>,
    },
    {
      id: "amt",
      header: "Amount",
      align: "right",
      cellClassName: "font-mono font-semibold",
      // The sign is applied HERE and nowhere else. The API stores a magnitude
      // because a penalty is money IN to the pool and money OUT of the
      // technician, and this column is the technician's view — so a penalty
      // reads as a debit. See the note on `LedgerEntry`.
      cell: (l) => (
        <span className={l.kind === "penalty" ? "text-danger" : "text-ok"}>
          {moneyPaise(l.kind === "penalty" ? -l.amountPaise : l.amountPaise)}
        </span>
      ),
    },
  ];

  // The def keeps the label and the options; the value goes into
  // `params.filters` and the server narrows the ledger, so `match` is never
  // called while the table is in server mode.
  const filters: TypedFilterDef<LedgerEntry>[] = [
    {
      id: "kind",
      label: "Type",
      variant: "select",
      options: [
        { value: "penalty", label: "Penalty" },
        { value: "bonus", label: "Bonus" },
      ],
      value: kind,
      // A change, not a whole query — the page merges it in.
      onChange: (v) => onParams({ page: 1, filters: { kind: v } }),
      allValue: ALL,
      match: () => true,
    },
  ];

  return (
    <section className="mt-3.5">
      <h2 className="mb-3.5 text-sm font-semibold">Transaction ledger</h2>

      <DataTable
        errorTitle="Couldn't load the transaction ledger"
        caption="Cancellation penalties collected and escalation bonuses paid, by technician and ticket"
        data={entries}
        columns={columns}
        getRowId={(l) => l.id}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={onRetry}
        filters={filters}
        server={{ meta, params, onParams }}
        infinite={{
          hasNextPage,
          isFetchingNextPage,
          fetchNextPage,
          label: "transactions",
        }}
        // A ledger is chronological, and the server sorts it that way, so the
        // days come out as contiguous runs.
        groupBy={(l) => dayLabel(l.at, now)}
        minWidth="51.25rem"
        toolbarActions={
          /* Exported in the browser — the rows are already here, so this
             needs no endpoint. It exports what has been LOADED, which is what
             the reader can see; a whole-ledger export is an endpoint, not a
             loop over pages. Amounts export as raw signed numbers, not
             money() strings: a spreadsheet has to be able to sum them. */
          <Button
            variant="outline"
            className="h-10 px-4 text-[13px] font-semibold"
            disabled={!visible.length}
            onClick={() =>
              downloadCsv(
                "reliancegreentech-ledger.csv",
                toCsv(
                  // Spelled out rather than taken from `columns`. The first
                  // column's header is "Time" now that the divider carries the
                  // date, but the export writes the whole instant — a
                  // spreadsheet wants the date back.
                  ["When", "Type", "Technician", "Ticket", "Reason", "Amount"],
                  visible.map((e) => [
                    e.at,
                    KIND_LABEL[e.kind],
                    e.technicianName,
                    e.ticketCode,
                    e.reason,
                    // Signed RUPEES, not the moneyPaise() string: a
                    // spreadsheet has to be able to sum the column.
                    (e.kind === "penalty" ? -e.amountPaise : e.amountPaise) / 100,
                  ])
                )
              )
            }
          >
            <Download data-icon="inline-start" />
            Export CSV
          </Button>
        }
        emptyTitle="No transactions yet"
        emptyDescription="Cancellation penalties collected and escalation bonuses paid will appear here."
      />
    </section>
  );
}
