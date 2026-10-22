import { PageMeta } from "@/components/shared/PageMeta";
import { TicketTable } from "@/components/tickets/TicketTable";
import { useFeatureAccess, useMe } from "@/hooks/useAuth";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import { useTickets } from "@/hooks/useTickets";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { ListParams } from "@/types/api";

/**
 * The franchisee's tickets — READ ONLY (§4.5).
 *
 * The SAME table and filters the ops console uses, pointed at the portal's own
 * base path; what this account may see is decided entirely by the server, which
 * scopes a franchise principal to its own pincodes and (for a facility role) to
 * the tickets carrying a spare-part request. No "assign", no "reschedule", no
 * force-close — the detail route below passes `actions={null}`, and nothing here
 * pretends otherwise, which is why the title says so.
 *
 * Not the staff `TicketListPage`: that page carries the import dialog and the
 * dashboard-links `NarrowedNotice`, neither of which exists on this surface.
 */
export default function FranchiseTicketsPage() {
  const { data: me } = useMe();
  const { paths } = useWorkspace();
  const { has } = useFeatureAccess();
  const { params, setParams } = useTicketFilters();
  const { data, isLoading, isError, error, refetch } = useTickets(params);

  // §5.9's two empty states depend on who is reading. A facility role's whole
  // brief here is spare-part requests — tickets that need nobody else — so its
  // empty state says that instead of pointing at work vendors had not raised
  // yet, which for a facility user is no work at all. Everything else on the
  // rail (technicians, payouts, pool, statements) is franchisee-admin work.
  const isFacility =
    has("franchise.tickets") &&
    !has("franchise.technicians") &&
    !has("franchise.payouts") &&
    !has("franchise.pool") &&
    !has("franchise.statements");

  // A franchise session NAMES its franchisee; the fallback only covers the
  // instant before `/auth/me` lands, and reads without the noun rather than
  // inventing one.
  const franchisee = me?.franchisee?.name;

  const emptyDescription = isFacility
    ? "Tickets with a spare-part request appear here."
    : franchisee
      ? `Tickets for ${franchisee}'s pincodes appear here once a vendor raises them.`
      : "Tickets for your pincodes appear here once a vendor raises them.";

  return (
    <>
      <PageMeta
        title="Tickets"
        description={
          isFacility
            ? "Spare-part work for your franchisee."
            : franchisee
              ? `Tickets in ${franchisee}'s pincodes — read only`
              : "Tickets in your pincodes — read only"
        }
      />

      <TicketTable
        basePath={paths.tickets}
        tickets={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={(next: ListParams) => setParams(next)}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        emptyDescription={emptyDescription}
        emptyTitle={isFacility ? "No tickets need you yet" : "No tickets yet"}
      />
    </>
  );
}