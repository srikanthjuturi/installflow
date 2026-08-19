import { PageMeta } from "@/components/shared/PageMeta";
import { TicketTable } from "@/components/tickets/TicketTable";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import { useTickets } from "@/hooks/useTickets";

export default function TicketListPage() {
  // The whole request — search, status, page, rows-per-page and sort — lives
  // in the query string, so the exact view someone is looking at is a URL they
  // can paste. The page owns it; the table borrows it and reports intent back.
  const { params, setParams } = useTicketFilters();
  const { data, isLoading, isError, error, refetch } = useTickets(params);

  return (
    <>
      <PageMeta
        title="Tickets"
        description="All installation & demo tickets."
      />

      <TicketTable
        tickets={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        emptyDescription="Tickets raised by your vendors will appear here."
      />
    </>
  );
}
