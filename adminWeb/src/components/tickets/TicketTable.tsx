import { useNavigate } from "react-router";
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

const COLUMNS = [
  "Ticket",
  "Customer",
  "Category / Model",
  "SLA",
  "Slot",
  "Technician",
  "Status",
  "SLA state",
];

interface TicketTableProps {
  tickets?: Ticket[];
  isLoading: boolean;
  error: unknown;
  isFiltered: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
}

export function TicketTable({
  tickets,
  isLoading,
  error,
  isFiltered,
  onRetry,
  onClearFilters,
}: TicketTableProps) {
  const navigate = useNavigate();

  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  if (!isLoading && !tickets?.length) {
    return isFiltered ? (
      <EmptyState
        title="No tickets match those filters"
        description="Try a different status, or clear the search."
        action={
          <button
            type="button"
            onClick={onClearFilters}
            className="text-brand-400 hover:text-brand-500 text-sm font-semibold"
          >
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState
        title="No tickets yet"
        description="Intake from API, Excel upload or manual entry will appear here."
      />
    );
  }

  return (
    <div className="scroll-x">
      <Table className="min-w-230">
        <TableHeader>
          <HeadTr>
            {COLUMNS.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
          </HeadTr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeleton rows={8} cols={COLUMNS.length} />
          ) : (
            tickets?.map((t) => (
              <Tr
                key={t.id}
                onClick={() => navigate(`/tickets/${t.id}`)}
                className="cursor-pointer"
              >
                <Td>
                  {/* The row is clickable, but the id stays a real link so it
                      is reachable by keyboard and opens in a new tab. */}
                  <a
                    href={`/tickets/${t.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-brand-400 font-mono text-xs font-semibold"
                  >
                    {t.id}
                  </a>
                  <div className="text-ink-3 mt-0.5 text-xs">
                    {t.vendor} · {t.created}
                  </div>
                </Td>
                <Td>
                  <div className="font-medium">{t.customer}</div>
                  <div className="text-ink-3 text-xs">{t.mobile}</div>
                </Td>
                <Td>
                  <div>{t.category}</div>
                  <div className="text-ink-3 max-w-50 truncate text-xs">{t.product}</div>
                </Td>
                <Td>{t.slaType}</Td>
                <Td>
                  <div>{t.slot}</div>
                  <div className="text-ink-3 text-xs">
                    {t.city} · {t.pincode}
                  </div>
                </Td>
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
  );
}
