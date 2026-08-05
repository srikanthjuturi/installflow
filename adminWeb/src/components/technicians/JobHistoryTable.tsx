import {
  HeadTr,
  Table,
  TableBody,
  TableHeader,
  Td,
  Th,
  Tr,
} from "@/components/shared/DataTable";
import { EmptyState, TableSkeleton } from "@/components/shared/states";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { JobHistoryEntry } from "@/services/technicians";

const COLUMNS = ["Ticket", "Category", "Date", "Outcome"];

const OUTCOME_CLASS: Record<JobHistoryEntry["outcome"], string> = {
  Closed: "bg-status-closed-bg text-status-closed",
  Cancelled: "bg-status-cancelled-bg text-status-cancelled",
};

export function JobHistoryTable({
  history,
  isLoading = false,
}: {
  history?: JobHistoryEntry[];
  isLoading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="border-line-2 border-b pb-3.5">
        <h2 className="text-sm font-semibold">Recent job history</h2>
      </CardHeader>

      <CardContent className="px-0">
        {!isLoading && !history?.length ? (
          <EmptyState
            title="No recent jobs"
            description="Jobs appear here once this technician accepts and closes a ticket."
          />
        ) : (
          <div className="scroll-x">
            <Table className="min-w-130">
              <TableHeader>
                <HeadTr>
                  {COLUMNS.map((c) => (
                    <Th key={c} scope="col">
                      {c}
                    </Th>
                  ))}
                </HeadTr>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeleton rows={4} cols={COLUMNS.length} />
                ) : (
                  history?.map((h) => (
                    <Tr key={h.id} className="hover:bg-transparent">
                      <Td>
                        <span className="text-brand-400 font-mono text-xs font-semibold">
                          {h.id}
                        </span>
                      </Td>
                      <Td>{h.cat}</Td>
                      <Td>{h.date}</Td>
                      <Td>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.25 py-0.75 text-[11px] font-semibold whitespace-nowrap",
                            OUTCOME_CLASS[h.outcome],
                          )}
                        >
                          {h.outcome}
                        </span>
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
