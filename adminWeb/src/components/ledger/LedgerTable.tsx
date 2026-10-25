import { Link } from "react-router";
import { Download, Undo2 } from "lucide-react";
import { useBrand } from "@/hooks/useBrand";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useMe } from "@/hooks/useAuth";
import {
  isReversible,
  ledgerFileName,
} from "@/components/franchise/ledgerAdapters";
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
import { moneyPaise, moneyPaiseSigned } from "@/utils/money";
import { ALL_FILTER, withFilter } from "@/hooks/useListParams";
import type { ListParams, PaginationMeta } from "@/types/api";
import type { LedgerEntry } from "@/types";
import {
  isKnownKind,
  kindChip,
  kindLabel,
  LEDGER_KINDS,
  poolSign,
} from "./ledgerKinds";

/**
 * Beside a penalty that was later given back. The table and the CSV both say
 * it this way, so the export reads "Penalty (reversed)" exactly as the row does.
 */
const REVERSED_MARK = "(reversed)";

const poolPaise = (e: LedgerEntry) => poolSign(e.kind) * e.amountPaise;

const ALL = ALL_FILTER;

interface LedgerTableProps {
  /**
   * The franchisee whose pool is on screen when it is NOT the reader's own —
   * §5.10's staff selector looking at a non-home pool. It names the CSV export
   * (`ledgerFileName`) so two files in one Downloads folder do not
   * indistinguishable-read; the franchise workspace derives it from the
   * principal instead and passes nothing here.
   */
  fileFranchiseeName?: string | null;
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
   * Task 09, §4.3 — the pool screen is where the FRANCHISEE's admin gives a
   * penalty back (`ledger.reverse` lives on the franchise adapter; the staff
   * one keeps its own reversal on the ticket page, per owner ruling 2026-10-16
   * R3, and passes neither prop). When given, a trailing column renders
   * **Reverse** on the rows `canReverse` — defaulting to `isReversible` —
   * returns true for, and the dialog itself stays on the page.
   */
  onReverse?: (e: LedgerEntry) => void;
  canReverse?: (e: LedgerEntry) => boolean;
  /**
   * When the rows were READ, as an epoch. It is what "Today" on a divider is
   * measured against — `new Date()` here would be an impure call during render
   * and would also drift from the data it is labelling.
   */
  readAt: number;
}

export function LedgerTable({
  entries,
  fileFranchiseeName,
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
  onReverse,
  canReverse,
}: LedgerTableProps) {
  const kind = params.filters?.kind ?? ALL;
  const now = new Date(readAt);
  const brand = useBrand();
  // Task 09 — both destinations are the shell's routes. The staff console
  // mounts this under `/ledger`; the portal under `/franchise/ledger`, beside
  // the same ticket board and technician roster its Franchisee column never
  // needed because every row is already theirs.
  const { paths, workspace } = useWorkspace();
  const me = useMe();
  // The franchise workspace pins the principal server-side, so the file name
  // is the one fact about who this ledger belongs to that the client knows:
  // without it `acme-appliances-…` and a franchise's own copy of the same
  // ledger are indistinguishable in a Downloads folder.
  const franchiseeName =
    workspace === "franchise" ? (me.data?.franchisee?.name ?? null) : null;
  // The staff selector's pool — null on the home/default read, where the file
  // is still the company's own ledger.
  const poolName = workspace === "ops" ? (fileFranchiseeName ?? null) : null;

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
              kindChip(l.kind)
            )}
          >
            {kindLabel(l.kind)}
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
          to={paths.technician(l.technicianId)}
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
          to={paths.ticket(l.ticketId)}
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
      // The POOL's sign — see `poolSign` in `ledgerKinds`. Green in, red out, and the `+`/`−`
      // says the same thing for anyone who cannot tell the two colours apart.
      cell: (l) => {
        const signed = poolPaise(l);
        // A kind this build has never heard of is unsigned AND uncoloured: the
        // direction is a guess, and a green `+` would assert it.
        const known = isKnownKind(l.kind);
        const tone = !known
          ? "text-ink"
          : signed < 0
            ? "text-danger"
            : "text-ok";
        return (
          <span className={tone}>
            {known ? moneyPaiseSigned(signed) : moneyPaise(signed)}
          </span>
        );
      },
    },
    // Task 09 — drawn only when the caller passes `onReverse`, i.e. only in
    // the franchise workspace, whose pool screen this is (§4.3). The staff
    // console's reversal stays on the ticket page (owner ruling R3), and a
    // column no workspace mounts is not shipped — `satisfies` keeps the
    // compiler checking it either way.
    ...(onReverse
      ? ([
          {
            id: "reverse",
            header: "",
            align: "right" as const,
            cell: (l) =>
              // The entry's own state is the check the server re-runs: a
              // reversal row, and a penalty already given back, both render
              // blank — same rule `PenaltiesPanel` follows on the ticket page.
              !(canReverse ?? isReversible)(l) ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onReverse(l)}
                >
                  <Undo2 data-icon="inline-start" aria-hidden />
                  Reverse
                </Button>
              ),
          },
        ] satisfies Column<LedgerEntry>[])
      : []),
  ];

  // The def keeps the label and the options; the value goes into
  // `params.filters` and the server narrows the ledger, so `match` is never
  // called while the table is in server mode.
  const filters: TypedFilterDef<LedgerEntry>[] = [
    {
      id: "kind",
      label: "Type",
      variant: "select",
      options: LEDGER_KINDS.map((k) => ({ value: k, label: kindLabel(k) })),
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
                // Task 09 — the shared name moved to the pure helper, and the
                // portal appends its franchisee, since its principal's ledger
                // and the company's own can both be acme-appliances-….
                ledgerFileName(brand.name, franchiseeName ?? poolName ?? undefined),
                toCsv(
                  // Spelled out rather than taken from `columns`. The first
                  // column's header is "Time" now that the divider carries the
                  // date, but the export writes the whole instant — a
                  // spreadsheet wants the date back.
                  ["When", "Type", "Technician", "Ticket", "Reason", "Amount"],
                  visible.map((e) => [
                    e.at,
                    e.reversed
                      ? `${kindLabel(e.kind)} ${REVERSED_MARK}`
                      : kindLabel(e.kind),
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
