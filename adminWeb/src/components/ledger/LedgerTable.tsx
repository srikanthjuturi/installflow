import { Link } from "react-router";
import { Download } from "lucide-react";
import { useBrand } from "@/hooks/useBrand";
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
import { moneyPaiseSigned } from "@/utils/money";
import { ALL_FILTER, withFilter } from "@/hooks/useListParams";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { LedgerEntry } from "@/types";

/**
 * Static class strings, one per kind — an interpolated `bg-${kind}-bg` would
 * never be generated.
 */
const KIND_CHIP: Record<LedgerEntry["kind"], string> = {
  penalty: "bg-danger-bg text-danger",
  bonus: "bg-ok-bg text-ok",
  // Money out of the pool like a bonus, but not a bonus — its own tone so the
  // two are never read as one.
  reversal: "bg-info-bg text-info",
};

/**
 * The wire value is lower case; the column prints the approved label.
 * "Penalty reversed" is net-new — neither prototype has a reversal — and was
 * approved as written on 2026-09-11.
 */
const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  penalty: "Penalty",
  bonus: "Bonus",
  reversal: "Penalty reversed",
};

/**
 * Beside a penalty that was later given back. The table and the CSV both say
 * it this way, so the export reads "Penalty (reversed)" exactly as the row does.
 */
const REVERSED_MARK = "(reversed)";

/**
 * Which way each kind moves the POOL — this screen's point of view, and the one
 * "Current pool balance" is the sum of. A penalty is collected into the pool;
 * a bonus is paid out of it; a reversal gives a penalty back to the technician,
 * so that money leaves the pool too.
 *
 * The API stores a magnitude and no sign because the direction depends on who
 * is looking: the technician's own Earnings reads the same rows the other way
 * round, a penalty as a debit. That view belongs to the app, not to this one.
 *
 * A reversed penalty keeps its `+`. It WAS collected, and its reversal row is
 * what takes it back out — so the signed rows still add up to the balance.
 * Striking the charge out as well would take the same money out twice.
 */
const POOL_SIGN: Record<LedgerEntry["kind"], 1 | -1> = {
  penalty: 1,
  bonus: -1,
  reversal: -1,
};

const poolPaise = (e: LedgerEntry) => POOL_SIGN[e.kind] * e.amountPaise;

const ALL = ALL_FILTER;

interface LedgerTableProps {
  /** Every page loaded so far, already filtered and sorted by the server. */
  entries?: LedgerEntry[];
  /** The LAST page's meta — `totalRecords` is the whole filtered ledger. */
  meta?: PaginationMeta;
  params: ListParams;
  /** The next whole query — see `applyParams` on the page. */
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
  const brand = useBrand();

  /* Both link columns leave the ledger, and both landed on a screen that sent
     the reader to its own list — a technician row to the roster, a ticket row
     to the board. Neither is where they were. The origin keeps the query
     string, so Back also restores the Type filter (`?type=` on the page). */
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
        // The word names the kind; the amount's sign and colour say which way
        // it moved the pool, so colour is never the only signal.
        <span className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-block rounded-full px-2.25 py-0.75 text-[11px] font-semibold",
              KIND_CHIP[l.kind]
            )}
          >
            {KIND_LABEL[l.kind]}
          </span>
          {/* The charge stays on the ledger as it was; this says it was later
              given back. The reversal is its own row, usually newer — in the
              reversal chip's colour, so the two read as one pair. */}
          {l.reversed ? (
            <span className="text-[11px] font-semibold text-info">
              {REVERSED_MARK}
            </span>
          ) : null}
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
      // The POOL's sign — see `POOL_SIGN`. Green in, red out, and the `+`/`−`
      // says the same thing for anyone who cannot tell the two colours apart.
      cell: (l) => {
        const signed = poolPaise(l);
        return (
          <span className={signed < 0 ? "text-danger" : "text-ok"}>
            {moneyPaiseSigned(signed)}
          </span>
        );
      },
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
        { value: "reversal", label: "Penalty reversed" },
      ],
      value: kind,
      // `withFilter` drops "All" rather than sending it as a kind — the API
      // matches nothing for kind "all", which is what emptied the ledger on
      // "Clear filters". The page drops it too; neither should rely on the other.
      onChange: (v) => onParams(withFilter(params, "kind", v)),
      allValue: ALL,
      match: () => true,
    },
  ];

  return (
    <section className="mt-3.5">
      <div className="mb-3.5">
        <h2 className="text-sm font-semibold">Transaction ledger</h2>
        {/* Says which side the signs are from. Without it a `+` on a penalty
            reads as the technician being paid, which is the opposite. */}
        <p className="mt-1 text-xs text-ink-3">
          <b className="font-semibold text-ok">+</b> is money into the pool,{" "}
          <b className="font-semibold text-danger">−</b> is money out of it. A
          reversed penalty keeps its row; the Penalty reversed row takes the
          money back out.
        </p>
      </div>

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
                // Named for the company whose ledger it is — someone who works
                // across two of them ends up with both files in one Downloads
                // folder, and a fixed product name makes them indistinguishable.
                `${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-ledger.csv`,
                toCsv(
                  // Spelled out rather than taken from `columns`. The first
                  // column's header is "Time" now that the divider carries the
                  // date, but the export writes the whole instant — a
                  // spreadsheet wants the date back.
                  ["When", "Type", "Technician", "Ticket", "Reason", "Amount"],
                  visible.map((e) => [
                    e.at,
                    e.reversed
                      ? `${KIND_LABEL[e.kind]} ${REVERSED_MARK}`
                      : KIND_LABEL[e.kind],
                    e.technicianName,
                    e.ticketCode,
                    e.reason,
                    // Signed RUPEES, not the moneyPaiseSigned() string: a
                    // spreadsheet has to be able to sum the column. The same
                    // pool sign as the table, so the sum is the balance.
                    poolPaise(e) / 100,
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
        // The default names a search box this table does not have.
        filteredEmptyDescription="Try a different type."
      />
    </section>
  );
}
