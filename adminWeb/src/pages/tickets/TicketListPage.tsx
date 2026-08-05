import { Card, CardContent } from "@/components/ui/card";
import { PageMeta } from "@/components/shared/PageMeta";
import { TicketFilters } from "@/components/tickets/TicketFilters";
import { TicketTable } from "@/components/tickets/TicketTable";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import { useTickets } from "@/hooks/useTickets";

export default function TicketListPage() {
  const { filters, search, status, setSearch, setStatus, clear, isFiltered } =
    useTicketFilters();
  const { data, isLoading, isError, error, refetch } = useTickets(filters);

  return (
    <>
      <PageMeta title="Tickets" description="All installation & demo tickets." />

      <TicketFilters
        search={search}
        status={status}
        onSearch={setSearch}
        onStatus={setStatus}
      />

      <Card>
        <CardContent className="px-0 pb-0">
          <div className="border-line-2 text-ink-2 flex items-center justify-between border-b px-4 pb-3 text-xs">
            <span aria-live="polite">
              Showing <b className="text-ink">{isLoading ? "…" : (data?.length ?? 0)}</b> tickets
            </span>
            <span>
              Sorted by <b className="text-ink">SLA urgency</b>
            </span>
          </div>

          <TicketTable
            tickets={data}
            isLoading={isLoading}
            error={isError ? error : null}
            isFiltered={isFiltered}
            onRetry={() => refetch()}
            onClearFilters={clear}
          />
        </CardContent>
      </Card>
    </>
  );
}
