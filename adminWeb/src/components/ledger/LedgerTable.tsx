import { Link } from "react-router";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/utils/csv";
import {
  DataTable,
  type Column,
  type TypedFilterDef,
} from "@/components/shared/DataTable";
import { formatDateTime } from "@/utils/datetime";
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
  /** One page of entries, already filtered and sorted by the server. */
  entries?: LedgerEntry[];
  meta?: PaginationMeta;
  params: ListParams;
  /** Merges what it is given into the query — see `applyParams` on the page. */
  onParams: (next: ListParams) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function LedgerTable({
  entries,
  meta,
  params,
  onParams,
  isLoading,
  error,
  onRetry,
}: LedgerTableProps) {
  const kind = params.filters?.kind ?? ALL;

  // The rows in hand — which, now the ledger is paged server-side, is the page
  // the reader is looking at.
  const visible = entries ?? [];

  const columns: Column<LedgerEntry>[] = [
    {
      id: "date",
      header: "Date",
      cell: (l) => formatDateTime(l.at),
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
        error={error}
        onRetry={onRetry}
        filters={filters}
        server={{ meta, params, onParams }}
        minWidth="51.25rem"
        toolbarActions={
          /* Exported in the browser — the rows are already here, so this
             needs no endpoint. It exports the page on screen, which is what
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
                  columns.map((c) => c.header),
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
