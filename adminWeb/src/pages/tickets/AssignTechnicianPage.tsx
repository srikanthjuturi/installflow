import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { CandidateTechTable } from "@/components/tickets/CandidateTechTable";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useAssignTicket, useTicket } from "@/hooks/useTickets";
import { useCandidateTechnicians } from "@/hooks/useTechnicians";
import { isTerminalTicketStatus } from "@/types";
import type { Technician } from "@/types/technician";

/**
 * Manual assignment — §7's last resort, after a bonus re-notification has
 * already failed to find anybody.
 *
 * The one assignment screen. The escalation queue used to carry a second copy
 * at `/escalations/:id/assign` over a mock keyed by ticket CODE, so a real
 * ticket's UUID could only ever answer "Escalation <uuid> not found"; that
 * path now redirects here. Both the ticket and the shortlist beside it are
 * real, and so is the assignment.
 */
export default function AssignTechnicianPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);
  // Eligibility is a question about THIS ticket — its subcategory, its
  // pincode — so the query waits for the ticket rather than asking early and
  // showing a list that is not the shortlist. The slot goes with them: the
  // capacity column has to describe the day the WORK happens, or it reports
  // today's load for a Friday job and the assign call refuses somebody the
  // screen just showed as free.
  const candidates = useCandidateTechnicians(
    ticket?.subcategoryId,
    ticket?.pincode,
    ticket?.slotStart
  );
  const assign = useAssignTicket();

  const [pending, setPending] = useState<string | null>(null);

  function onAssign(tech: Technician) {
    if (!ticket) return;
    setPending(tech.id);
    assign.mutate(
      { id: ticket.id, technicianId: tech.id, technicianName: tech.name },
      {
        onSuccess: () => {
          toast.add({ title: `${tech.name} assigned to ${ticket.code}` });
          navigate(`/tickets/${ticket.id}`);
        },
        onSettled: () => setPending(null),
      }
    );
  }

  // Same guard, same reason, as `ForceClosePage` — see the note there. A
  // settled ticket has nobody left to send, and the shortlist below would
  // otherwise offer a manager a dozen technicians for a job that is over.
  if (ticket && isTerminalTicketStatus(ticket.status)) {
    return <Navigate to={`/tickets/${ticket.id}`} replace />;
  }

  return (
    <>
      <PageMeta
        title="Manual assignment"
        description="Assign an eligible technician to a ticket."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to={`/tickets/${id}`}
      >
        <ArrowLeft data-icon="inline-start" />
        Back to ticket
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this ticket"
          error={error}
          onRetry={() => refetch()}
        />
      ) : (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-line-2 p-4.5">
            <CardTitle>
              <h2>Manual technician assignment</h2>
            </CardTitle>
            <p className="text-xs text-ink-3">
              Eligible by category and pincode.
            </p>
            <CardAction className="self-center">
              {isLoading || !ticket ? (
                <Skeleton className="h-4 w-56" />
              ) : (
                <span className="text-xs text-ink-2">
                  Ticket <b className="font-mono">{ticket.code}</b> ·{" "}
                  {ticket.modelName} · {ticket.pincode}
                </span>
              )}
            </CardAction>
          </CardHeader>

          <CardContent className="px-0">
            {assign.isError ? (
              <p
                role="alert"
                className="border-b border-line-2 bg-danger-bg px-4.5 py-3 text-xs text-danger"
              >
                {assign.error instanceof Error
                  ? assign.error.message
                  : "Something went wrong. Try again."}
              </p>
            ) : null}

            {/* DataTable brings its own toolbar and panel, so it is inset
                inside the card rather than sitting flush against it. */}
            <div className="p-4.5">
              <CandidateTechTable
                technicians={candidates.data}
                isLoading={isLoading || candidates.isLoading}
                error={candidates.error}
                onRetry={() => candidates.refetch()}
                onAssign={onAssign}
                assigningId={pending}
                isAssigning={assign.isPending}
                currentTechnicianId={ticket?.technicianId}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
