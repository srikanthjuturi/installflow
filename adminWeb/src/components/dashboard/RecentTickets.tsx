import { Link } from "react-router";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import type { Ticket } from "@/types";

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
      <CardContent className="px-0">
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
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeleton rows={6} cols={7} />
                ) : (
                  tickets?.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link
                          to={`/tickets/${t.id}`}
                          className="hover:text-brand-400 font-semibold"
                        >
                          {t.id}
                        </Link>
                        <div className="text-ink-3 text-xs">{t.vendor}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{t.customer}</div>
                        <div className="text-ink-3 text-xs">
                          {t.city} · {t.pincode}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{t.category}</div>
                        <div className="text-ink-3 max-w-45 truncate text-xs">{t.product}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{t.slot}</TableCell>
                      <TableCell className="whitespace-nowrap">{t.tech}</TableCell>
                      <TableCell>
                        <StatusBadge status={t.status} />
                      </TableCell>
                      <TableCell>
                        <SlaBadge state={t.sla} />
                      </TableCell>
                    </TableRow>
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
