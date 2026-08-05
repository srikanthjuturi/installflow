import { useMemo, useState } from "react";
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
import { money } from "@/utils/money";
import type { LedgerEntry } from "@/types";

/**
 * Static class strings, one per entry type — an interpolated `bg-${type}-bg`
 * would never be generated.
 */
const TYPE_CHIP: Record<LedgerEntry["type"], string> = {
  Penalty: "bg-danger-bg text-danger",
  Bonus: "bg-ok-bg text-ok",
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
 * "Aug 4" → a comparable number. Sorting the label itself would file "Aug 2"
 * ahead of "Jul 30", because the collator only sees the letters.
 */
function dateKey(date: string): number | null {
  const [month, day] = date.trim().split(/\s+/);
  const index = MONTHS.indexOf(month);
  return index === -1 ? null : index * 100 + Number(day ?? 0);
}

const ALL = "All";

interface LedgerTableProps {
  entries?: LedgerEntry[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function LedgerTable({
  entries,
  isLoading,
  error,
  onRetry,
}: LedgerTableProps) {
  // The type filter is controlled here so the export can send the same rows
  // the reader is looking at, rather than the whole ledger.
  const [type, setType] = useState(ALL);

  const visible = useMemo(
    () => (entries ?? []).filter((e) => type === ALL || e.type === type),
    [entries, type]
  );

  const columns: Column<LedgerEntry>[] = [
    {
      id: "id",
      header: "Entry",
      cell: (l) => <span className="font-mono text-xs">{l.id}</span>,
    },
    {
      id: "date",
      header: "Date",
      sortValue: (l) => dateKey(l.date),
      cell: (l) => l.date,
    },
    {
      id: "type",
      header: "Type",
      sortValue: (l) => l.type,
      cell: (l) => (
        // The word carries the debit/credit distinction, so the amount's
        // colour is never the only signal.
        <span
          className={cn(
            "inline-block rounded-full px-2.25 py-0.75 text-[11px] font-semibold",
            TYPE_CHIP[l.type]
          )}
        >
          {l.type}
        </span>
      ),
    },
    { id: "tech", header: "Technician", cell: (l) => l.tech },
    {
      id: "ticket",
      header: "Ticket",
      cell: (l) => (
        <Link
          to={`/tickets/${l.ticket}`}
          className="font-mono text-xs font-semibold text-brand-400 hover:underline"
        >
          {l.ticket}
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
      // The raw signed number, never the money() string — otherwise −₹800
      // would sort as text and land above ₹400.
      sortValue: (l) => l.amt,
      cellClassName: "font-mono font-semibold",
      cell: (l) => (
        <span className={l.amt < 0 ? "text-danger" : "text-ok"}>
          {money(l.amt)}
        </span>
      ),
    },
  ];

  const filters: TypedFilterDef<LedgerEntry>[] = [
    {
      id: "type",
      label: "Type",
      variant: "select",
      options: [
        { value: "Penalty", label: "Penalty" },
        { value: "Bonus", label: "Bonus" },
      ],
      value: type,
      onChange: setType,
      allValue: ALL,
      match: (l, v) => l.type === v,
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
        defaultSort={{ columnId: "date", dir: "desc" }}
        minWidth="51.25rem"
        toolbarActions={
          /* Exported in the browser — the rows are already here, so this
             needs no endpoint. Amounts export as raw signed numbers, not
             money() strings: a spreadsheet has to be able to sum them. */
          <Button
            variant="outline"
            className="h-10 px-4 text-[13px] font-semibold"
            disabled={!visible.length}
            onClick={() =>
              downloadCsv(
                "installflow-ledger.csv",
                toCsv(
                  columns.map((c) => c.header),
                  visible.map((e) => [
                    e.id,
                    e.date,
                    e.type,
                    e.tech,
                    e.ticket,
                    e.reason,
                    e.amt,
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
