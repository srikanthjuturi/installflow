import { ArrowLeft } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { TicketTable } from "@/components/tickets/TicketTable";
import { readNavOrigin } from "@/hooks/useNavOrigin";
import { useTechnician } from "@/hooks/useTechnicians";
import { useTicketFilters } from "@/hooks/useTicketFilters";
import { useTechnicianTickets } from "@/hooks/useTickets";

/**
 * Every ticket one technician has worked — the page behind the profile's
 * "See all".
 *
 * It renders the SAME `TicketTable` as the board rather than a second table of
 * its own, so search, the status pills, sorting and paging are the ones people
 * already know, and a column added to the board appears here too. The only
 * difference is the technician filter, which the page holds and the table
 * never sees.
 *
 * That filter is deliberately NOT in the query string. `useTicketFilters` owns
 * the parts of the request a person changes; the technician comes from the
 * route, so it cannot be cleared by accident and a pasted URL always describes
 * the same technician.
 */
export default function TechnicianJobsPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  // Only for the heading — the list does not wait on it.
  const { data: tech } = useTechnician(id);

  /* The profile is the only way in, so the fallback is the whole story. The
     origin is read for what sits BEHIND the profile — a ledger row, a search —
     so two Backs from here return there instead of the roster. */
  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? `/technicians/${id}`;
  const backText = origin?.backLabel ?? "Back to profile";
  const { params, setParams } = useTicketFilters();
  const { data, isLoading, isError, error, refetch } = useTechnicianTickets(
    id,
    params
  );

  const who = tech?.name ?? "this technician";

  return (
    <>
      <PageMeta
        title={tech?.name ? `${tech.name} · Tickets` : "Technician tickets"}
        description="Every ticket this technician has worked, with search, status and paging."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to={backHref}
        state={origin?.backState}
      >
        <ArrowLeft data-icon="inline-start" />
        {backText}
      </LinkButton>

      {/* Named, because a filtered list that does not say what filters it is a
          list somebody will mistake for every ticket. The name loads a moment
          after the table, so the fallback has to read properly on its own. */}
      <h1 className="mb-3.5 text-base font-semibold">Tickets · {who}</h1>

      <TicketTable
        tickets={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        emptyDescription="Jobs appear here once this technician accepts a ticket."
        // Comes back to THIS list, on this page, with these filters.
        backLabel={tech ? `Back to ${tech.name}` : "Back to technician"}
        backState={origin}
      />
    </>
  );
}
