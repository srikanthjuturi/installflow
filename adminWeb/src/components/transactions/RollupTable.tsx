import { Building2 } from "lucide-react";
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
import { balanceWording, type CompanyRollup } from "@/types/transaction";
import { moneyPaise } from "@/utils/money";

/**
 * "All companies" - the superadmin's roll-up over the chosen period: each
 * company's documents and debit / credit / net totals. A statement across
 * companies would add up money that was never in one account, so each row's
 * action opens THAT company's platform account instead.
 */
export function RollupTable({
  rows,
  isLoading,
  error,
  onRetry,
  onOpenStatement,
}: {
  rows?: CompanyRollup[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpenStatement: (row: CompanyRollup) => void;
}) {
  return (
    <Card className="mb-4">
      <CardContent>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">All companies</h2>
          <span className="text-xs text-ink-3">Totals for the period above</span>
        </div>
        {error && !rows ? (
          <ErrorState
            title="Couldn't load the roll-up"
            error={error}
            onRetry={onRetry}
          />
        ) : !isLoading && rows && rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No documents in this period"
            description="No company has a numbered document between these dates."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[44rem]">
              <caption className="sr-only">
                Each company's documents and debit, credit and net totals for the period
              </caption>
              <TableHeader>
                <HeadTr>
                  <Th>Company</Th>
                  <Th className="text-right">Documents</Th>
                  <Th className="text-right">Debit</Th>
                  <Th className="text-right">Credit</Th>
                  <Th className="text-right">Net</Th>
                  <Th>
                    <span className="sr-only">Action</span>
                  </Th>
                </HeadTr>
              </TableHeader>
              <TableBody>
                {isLoading && !rows ? (
                  <TableSkeleton rows={4} cols={6} />
                ) : (
                  (rows ?? []).map((r) => (
                    <Tr key={r.companyId}>
                      <Td className="font-medium">{r.companyName}</Td>
                      <Td className="text-right tabular-nums">{r.documents}</Td>
                      <Td className="text-right tabular-nums">
                        {moneyPaise(r.debitPaise)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {moneyPaise(r.creditPaise)}
                      </Td>
                      <Td className="text-right font-semibold tabular-nums">
                        {moneyPaise(r.netPaise)}
                        <span className="sr-only"> {balanceWording(r.netPaise).phrase}</span>
                      </Td>
                      <Td className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenStatement(r)}
                        >
                          Open statement
                          <span className="sr-only"> for {r.companyName}</span>
                        </Button>
                      </Td>
                    </Tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
