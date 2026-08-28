import { ArrowLeft } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states";
import { FactGrid } from "@/components/tickets/FactGrid";
import { CustomerVerdict } from "@/components/tickets/CustomerVerdict";
import { SerialMismatchBanner } from "@/components/tickets/SerialMismatch";
import {
  CustomerPanel,
  ProofPanel,
  TechnicianPanel,
} from "@/components/tickets/SidePanels";
import { Timeline } from "@/components/tickets/Timeline";
import { readNavOrigin } from "@/hooks/useNavOrigin";
import { useTicket } from "@/hooks/useTickets";
import { isTerminalTicketStatus } from "@/types";

/**
 * One ticket, on two surfaces.
 *
 * The ops console and the vendor portal show the same facts; only where "back"
 * goes and which actions exist differ. `actions` is a slot rather than a
 * boolean so the portal passes `null` and neither surface has to know what the
 * other renders.
 */
export default function TicketDetailPage({
  backTo,
  backLabel,
  actions,
}: {
  backTo?: string;
  backLabel?: string;
  /** The ops pair by default; `null` in the portal, where a vendor
   *  force-closing or re-assigning its own ticket makes no sense. */
  actions?: React.ReactNode;
} = {}) {
  const { id = "" } = useParams();
  const location = useLocation();

  /* One route, several ways in: the board, a technician's recent jobs, a
     technician's full list. Whoever navigated left an origin in router state,
     so "Back" returns THERE — and to the same page of the same filtered list,
     because the origin carries the query string too.

     Order matters. An explicit prop wins because that is the portal pinning a
     vendor to `/portal/tickets`, and a vendor must never be handed a link into
     the ops side. State comes next. The board is the last resort: state is gone
     after a reload or on a pasted link, and a dead-end detail page is worse
     than a back button that goes somewhere reasonable. */
  const origin = readNavOrigin(location.state);
  const backHref = backTo ?? origin?.backTo ?? "/tickets";
  const backText = backLabel ?? origin?.backLabel ?? "Back to tickets";
  const {
    data: ticket,
    isLoading,
    isError,
    error,
    refetch,
    // `isFetching`, not `isLoading`: this is a re-read of a ticket already on
    // screen, and `isLoading` is only true when there is nothing to show.
    isFetching,
  } = useTicket(id);

  // The one switch between the two surfaces: a caller that named its actions
  // is the portal. Every ops-only control reads this, so a new one cannot be
  // added on the ops side and quietly appear on the vendor's.
  const isOps = actions === undefined;

  // Closed, Force-Closed and Cancelled are the end of the record. Force-closing
  // a ticket that is already closed, or sending a technician to a job nobody is
  // waiting on, are not things a manager can mean — so the controls go rather
  // than sit there waiting to be pressed and rejected.
  const isSettled = !!ticket && isTerminalTicketStatus(ticket.status);
  const canAct = isOps && !isSettled;

  return (
    <>
      <PageMeta
        title={`Ticket ${id}`}
        description="Ticket timeline and audit trail."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to={backHref}
      >
        <ArrowLeft data-icon="inline-start" />
        {backText}
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this ticket"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !ticket ? (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-52 rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </div>
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
          <div className="flex flex-col gap-3.5">
            <Card>
              <CardContent>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="font-mono text-base font-semibold">
                        {ticket.code}
                      </h2>
                      <StatusBadge status={ticket.status} />
                      <SlaBadge state={ticket.slaState} />
                    </div>
                    <p className="mt-1.5 text-[13px] text-ink-2">
                      {ticket.modelName} · {ticket.serviceType} · {ticket.serviceLevelHours}h
                    </p>
                  </div>

                  {isOps ? (
                    canAct ? (
                      <div className="flex flex-wrap gap-2.5">
                        <LinkButton
                          variant="outline"
                          className="hover:border-danger hover:text-danger"
                          to={`/tickets/${ticket.id}/force-close`}
                        >
                          Force close
                        </LinkButton>
                        <LinkButton to={`/tickets/${ticket.id}/assign`}>
                          Re-assign
                        </LinkButton>
                      </div>
                    ) : null
                  ) : (
                    actions
                  )}
                </div>

                <FactGrid ticket={ticket} />

                {/* Above the timeline and below the facts: it is about one of
                    those facts, and it is the reason anybody arriving from the
                    bell opened this ticket. Both surfaces show it — the vendor
                    holds the invoice, so it is often theirs to settle. */}
                <SerialMismatchBanner ticket={ticket} />
              </CardContent>
            </Card>

            {/* The same query the whole page reads — refreshing the trail
                refreshes the facts above it, which is the honest behaviour:
                a timeline newer than the status beside it would be worse
                than a stale one. */}
            <Timeline
              events={ticket.timeline}
              onRefresh={() => void refetch()}
              isRefreshing={isFetching}
            />
          </div>

          <div className="flex flex-col gap-3.5">
            {/* Above the customer's contact details: on an escalated ticket
                this is the reason the manager opened the page, and it should
                not be below the fold under an address they already know. */}
            <CustomerVerdict ticket={ticket} />
            <CustomerPanel ticket={ticket} />
            <TechnicianPanel
              ticket={ticket}
              // Assignment is an ops job. On the portal this was a button
              // that linked into the ops assignment screen, which
              // `RequirePortalFeature` denies — a control that could only ever
              // bounce the vendor who pressed it.
              //
              // It points at `/tickets/:id/assign`, not the escalation
              // queue's `/escalations/:id/assign`: that screen looks its
              // subject up in the escalation MOCK, whose three rows are keyed
              // by ticket CODE, so a real ticket's UUID could only ever come
              // back as "Escalation <uuid> not found".
              //
              // It disappears on a settled ticket for the same reason the pair
              // in the header do: it is the same re-assignment, reached from
              // the panel it would change.
              action={
                canAct ? (
                  <LinkButton
                    variant="outline"
                    size="sm"
                    to={`/tickets/${ticket.id}/assign`}
                  >
                    Assign manually
                  </LinkButton>
                ) : null
              }
            />
            <ProofPanel ticket={ticket} />
          </div>
        </div>
      )}
    </>
  );
}
