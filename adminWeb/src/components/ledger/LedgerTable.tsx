import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  HeadTr,
  Table,
  TableBody,
  TableHeader,
  Td,
  Th,
  Tr,
} from "@/components/shared/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { money } from "@/utils/money";
import type { LedgerEntry } from "@/types";

const COLUMNS = ["Entry", "Date", "Type", "Technician", "Ticket", "Reason", "Amount"];

/**
 * Static class strings, one per entry type — an interpolated `bg-${type}-bg`
 * would never be generated.
 */
const TYPE_CHIP: Record<LedgerEntry["type"], string> = {
  Penalty: "bg-danger-bg text-danger",
  Bonus: "bg-ok-bg text-ok",
};

interface LedgerTableProps {
  entries?: LedgerEntry[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function LedgerTable({ entries, isLoading, error, onRetry }: LedgerTableProps) {
  return (
    <Card className="mt-3.5">
      <CardContent className="px-0 pb-0">
        <div className="border-line-2 flex flex-wrap items-center justify-between gap-2.5 border-b px-4 pb-3.5">
          <h2 className="text-sm font-semibold">Transaction ledger</h2>
          {/* No-op until the backend phase — there is no export endpoint yet. */}
          <Button variant="outline" className="h-10 px-4 text-[13px] font-semibold">
            Export CSV
          </Button>
        </div>

        <LedgerRows entries={entries} isLoading={isLoading} error={error} onRetry={onRetry} />
      </CardContent>
    </Card>
  );
}

function LedgerRows({ entries, isLoading, error, onRetry }: LedgerTableProps) {
  if (error) {
    return <ErrorState title="Couldn't load the transaction ledger" error={error} onRetry={onRetry} />;
  }

  if (!isLoading && !entries?.length) {
    return (
      <EmptyState
        title="No transactions yet"
        description="Cancellation penalties collected and escalation bonuses paid will appear here."
      />
    );
  }

  return (
    <div className="scroll-x">
      <Table className="min-w-205">
        <TableHeader>
          <HeadTr>
            {COLUMNS.map((c) => (
              <Th key={c} className={c === "Amount" ? "text-right" : undefined}>
                {c}
              </Th>
            ))}
          </HeadTr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton rows={6} cols={COLUMNS.length} />
          ) : (
            entries?.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <span className="font-mono text-xs">{l.id}</span>
                </Td>
                <Td>{l.date}</Td>
                <Td>
                  {/* The word carries the debit/credit distinction, so the
                      amount's colour is never the only signal. */}
                  <span
                    className={cn(
                      "inline-block rounded-full px-2.25 py-0.75 text-[11px] font-semibold",
                      TYPE_CHIP[l.type],
                    )}
                  >
                    {l.type}
                  </span>
                </Td>
                <Td>{l.tech}</Td>
                <Td>
                  <Link
                    to={`/tickets/${l.ticket}`}
                    className="text-brand-400 font-mono text-xs font-semibold hover:underline"
                  >
                    {l.ticket}
                  </Link>
                </Td>
                <Td>
                  <span className="text-ink-2 text-xs">{l.reason}</span>
                </Td>
                <Td
                  className={cn(
                    "text-right font-mono font-semibold",
                    l.amt < 0 ? "text-danger" : "text-ok",
                  )}
                >
                  {money(l.amt)}
                </Td>
              </Tr>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
