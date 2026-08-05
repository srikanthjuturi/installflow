import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { SlaBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states";
import { FactGrid } from "@/components/tickets/FactGrid";
import {
  CustomerPanel,
  ProofPanel,
  TechnicianPanel,
} from "@/components/tickets/SidePanels";
import { Timeline } from "@/components/tickets/Timeline";
import { useTicket } from "@/hooks/useTickets";

/** Proof only exists once the job has reached verification or closure. */
const PROOF_STATUSES = new Set(["AI Review", "Closed", "Force-Closed"]);

export default function TicketDetailPage() {
  const { id = "" } = useParams();
  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);

  return (
    <>
      <PageMeta title={`Ticket ${id}`} description="Ticket timeline and audit trail." />

      <Button
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        nativeButton={false}
        render={<Link to="/tickets" />}
      >
        <ArrowLeft data-icon="inline-start" />
        Back to tickets
      </Button>

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
                      <h2 className="font-mono text-base font-semibold">{ticket.id}</h2>
                      <StatusBadge status={ticket.status} />
                      <SlaBadge state={ticket.sla} />
                    </div>
                    <p className="text-ink-2 mt-1.5 text-[13px]">
                      {ticket.product} · {ticket.slaType} SLA
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    <Button
                      variant="outline"
                      className="hover:border-danger hover:text-danger"
                      nativeButton={false}
                      render={<Link to={`/tickets/${ticket.id}/force-close`} />}
                    >
                      Force close
                    </Button>
                    <Button
                      nativeButton={false}
                      render={<Link to={`/escalations/${ticket.id}/assign`} />}
                    >
                      Re-assign
                    </Button>
                  </div>
                </div>

                <FactGrid ticket={ticket} />
              </CardContent>
            </Card>

            <Timeline events={ticket.timeline} />
          </div>

          <div className="flex flex-col gap-3.5">
            <CustomerPanel ticket={ticket} />
            <TechnicianPanel ticket={ticket} />
            <ProofPanel hasProof={PROOF_STATUSES.has(ticket.status)} />
          </div>
        </div>
      )}
    </>
  );
}
