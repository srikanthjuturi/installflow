import { ArrowLeft } from "lucide-react";
import { useParams } from "react-router";
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
import { useTicket } from "@/hooks/useTickets";

/**
 * One ticket, on two surfaces.
 *
 * The ops console and the vendor portal show the same facts; only where "back"
 * goes and which actions exist differ. `actions` is a slot rather than a
 * boolean so the portal passes `null` and neither surface has to know what the
 * other renders.
 */
export default function TicketDetailPage({
  backTo = "/tickets",
  backLabel = "Back to tickets",
  actions,
}: {
  backTo?: string;
  backLabel?: string;
  /** The ops pair by default; `null` in the portal, where a vendor
   *  force-closing or re-assigning its own ticket makes no sense. */
  actions?: React.ReactNode;
} = {}) {
  const { id = "" } = useParams();
  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);

  // The one switch between the two surfaces: a caller that named its actions
  // is the portal. Every ops-only control reads this, so a new one cannot be
  // added on the ops side and quietly appear on the vendor's.
  const isOps = actions === undefined;

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
        to={backTo}
      >
        <ArrowLeft data-icon="inline-start" />
        {backLabel}
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

            <Timeline events={ticket.timeline} />
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
              action={
                isOps ? (
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
