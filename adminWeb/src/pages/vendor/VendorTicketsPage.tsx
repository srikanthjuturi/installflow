import { PageMeta } from "@/components/shared/PageMeta";
import { TicketTable } from "@/components/tickets/TicketTable";
import { useMe } from "@/hooks/useAuth";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import { useTickets } from "@/hooks/useTickets";

/**
 * The vendor's own tickets.
 *
 * The SAME table and the same filters the ops console uses — only the row
 * destination and the empty copy differ. What this account may see is decided
 * entirely by the server: a vendor gets every ticket raised against its brand,
 * a vendor user only the ones they raised themselves.
 *
 * So there is no "mine / all" toggle and no "raised by" column. The API offers
 * no such choice, and a control that pretended to would be the UI inventing an
 * authorization model of its own.
 */
export default function VendorTicketsPage() {
  const { params, setParams } = useTicketFilters();
  const { data, isLoading, isError, error, refetch } = useTickets(params);
  const { data: me } = useMe();

  const canRaise = (me?.vendor?.intakeChannels ?? []).includes("Manual");

  return (
    <>
      <PageMeta title="My tickets" description="Tickets you have raised." />

      <h2 className="mb-4 text-lg font-semibold">My tickets</h2>

      <TicketTable
        basePath="/portal/tickets"
        tickets={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        emptyDescription={
          canRaise
            ? "Raise your first ticket and it will appear here."
            : // No entry channel is enabled for this vendor, so the empty state
              // has to explain the absence rather than point at a button that
              // is not there.
              "No ticket entry is enabled for your account yet. Ask the team who set it up."
        }
      />
    </>
  );
}
