import { ArrowLeft } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { JobHistoryTable } from "@/components/technicians/JobHistoryTable";
import {
  TechOnboardingCard,
  TechOnboardingCardSkeleton,
} from "@/components/technicians/TechOnboardingCard";
import {
  TechProfileHeader,
  TechStats,
} from "@/components/technicians/TechProfileHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { readNavOrigin } from "@/hooks/useNavOrigin";
import { useTechnician } from "@/hooks/useTechnicians";
import { useTechnicianJobs } from "@/hooks/useTickets";
import { useRecordRecentlySeen } from "@/store/recentlySeen";

export default function TechnicianProfilePage() {
  const { id = "" } = useParams();
  const location = useLocation();

  /* Three ways in — the roster, a ledger row, the topbar search — and only the
     first one is `/technicians`. The search has been handing this page an
     origin since it was built; the page was throwing it away and sending
     everybody to the roster regardless. The roster stays the fallback: it is
     where a pasted link, which carries no state, most plausibly belongs. */
  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/technicians";
  const backText = origin?.backLabel ?? "Back to technicians";

  const { data: tech, isLoading, isError, error, refetch } = useTechnician(id);
  /* Beside the profile read, not behind it: the two are independent, and
     waiting for the record before asking for the jobs would put a second
     round trip in front of the table for no reason. */
  const jobs = useTechnicianJobs(id);

  // Into the topbar search's "Recently seen" — a technician reached from the
  // roster or from a ticket counts as seen, not only one found by searching.
  useRecordRecentlySeen(
    "technician",
    tech?.id,
    tech?.name,
    tech ? `${tech.phone} · ${tech.code}` : null
  );

  return (
    <>
      <PageMeta
        title={`Technician ${id}`}
        description="Category, pincode, bandwidth, cancellations and job history."
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

      {isError ? (
        <ErrorState
          title="Couldn't load this technician"
          error={error}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.7fr]">
          {isLoading || !tech ? (
            <Skeleton className="h-125 rounded-xl" />
          ) : (
            <TechProfileHeader tech={tech} />
          )}

          <div className="flex flex-col gap-3.5">
            {isLoading || !tech ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-21 rounded-xl" />
                ))}
              </div>
            ) : (
              <TechStats tech={tech} />
            )}

            {/* Who appointed them, who filled the record in, and when. */}
            {isLoading || !tech ? (
              <TechOnboardingCardSkeleton />
            ) : (
              <TechOnboardingCard tech={tech} />
            )}

            {/* The skeleton is the real table, row for row — never a spinner.
                Its own query rather than a field on the technician: the ticket
                list already scopes by territory and pages in SQL, so this is
                five rows of the same source the ticket screens read, not a
                second answer to the same question.

                `totalRecords` comes back with those five, so "See all" can name
                the real count without a second request. */}
            <JobHistoryTable
              jobs={jobs.data?.rows}
              total={jobs.data?.pagination.totalRecords}
              seeAllTo={`/technicians/${id}/tickets`}
              backLabel={
                tech ? `Back to ${tech.name}` : "Back to technician"
              }
              // Forwarded so a ticket opened from here comes back to this
              // profile, and the profile still knows about the ledger row or
              // the search that opened IT.
              backState={origin}
              isLoading={isLoading || jobs.isLoading}
              error={jobs.error}
              onRetry={() => jobs.refetch()}
            />
          </div>
        </div>
      )}
    </>
  );
}
