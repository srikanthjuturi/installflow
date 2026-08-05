import { Link } from "react-router";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HeadTr,
  Table,
  TableBody,
  TableHeader,
  Td,
  Th,
  Tr,
} from "@/components/shared/DataTable";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import type { Ticket } from "@/types";

const COLUMNS = ["Ticket", "Customer", "Category", "Slot", "Technician", "Status", "SLA"];

interface RecentTicketsProps {
  tickets?: Ticket[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function RecentTickets({ tickets, isLoading, error, onRetry }: RecentTicketsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent tickets</CardTitle>
        <CardAction>
          <Link
            to="/tickets"
            className="text-brand-400 hover:text-brand-500 text-xs font-semibold"
          >
            Open ticket list →
          </Link>
        </CardAction>
      </CardHeader>
      {/* Table runs edge to edge; the last row's hairline is the card's floor. */}
      <CardContent className="px-0 pb-0">
        {error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : !isLoading && !tickets?.length ? (
          <EmptyState
            title="No tickets yet"
            description="New intake will appear here as it arrives."
          />
        ) : (
          <div className="scroll-x">
            <Table>
              <TableHeader>
                <HeadTr>
                  {COLUMNS.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </HeadTr>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeleton rows={6} cols={COLUMNS.length} />
                ) : (
                  tickets?.map((t) => (
                    <Tr key={t.id}>
                      <Td>
                        <Link
                          to={`/tickets/${t.id}`}
                          className="hover:text-brand-400 font-semibold"
                        >
                          {t.id}
                        </Link>
                        <div className="text-ink-3 text-xs">{t.vendor}</div>
                      </Td>
                      <Td>
                        <div className="font-medium">{t.customer}</div>
                        <div className="text-ink-3 text-xs">
                          {t.city} · {t.pincode}
                        </div>
                      </Td>
                      <Td>
                        <div>{t.category}</div>
                        <div className="text-ink-3 max-w-45 truncate text-xs">{t.product}</div>
                      </Td>
                      <Td>{t.slot}</Td>
                      <Td>{t.tech}</Td>
                      <Td>
                        <StatusBadge status={t.status} />
                      </Td>
                      <Td>
                        <SlaBadge state={t.sla} />
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
