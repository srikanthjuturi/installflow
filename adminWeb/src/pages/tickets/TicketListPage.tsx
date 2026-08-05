import { Plus } from "lucide-react";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { TicketTable } from "@/components/tickets/TicketTable";
import { useTickets } from "@/hooks/useTickets";

export default function TicketListPage() {
  // One unfiltered fetch: the table owns search, status, sorting and paging
  // from here, so typing no longer re-queries per keystroke.
  const { data, isLoading, isError, error, refetch } = useTickets();

  return (
    <>
      <PageMeta
        title="Tickets"
        description="All installation & demo tickets."
      />

      <TicketTable
        tickets={data}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        toolbarActions={
          <LinkButton className="h-10" to="/tickets/new">
            <Plus data-icon="inline-start" />
            New ticket
          </LinkButton>
        }
      />
    </>
  );
}
