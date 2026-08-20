import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router";
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
import type { Technician } from "@/types/technician";

/**
 * Manual assignment, from a REAL ticket.
 *
 * The escalation queue has its own copy of this screen at
 * `/escalations/:id/assign`, and it is still the mock's — its rows are three
 * hardcoded escalations keyed by ticket code. The ticket screens used to link
 * there with a ticket UUID, which could only ever answer "Escalation <uuid>
 * not found". This is the ticket-shaped one: the ticket comes from the API and
 * so does the shortlist beside it. The two converge when the escalation queue
 * binds.
 */
export default function AssignTechnicianPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);
  // Eligibility is a question about THIS ticket — its subcategory, its
  // pincode — so the query waits for the ticket rather than asking early and
  // showing a list that is not the shortlist.
  const candidates = useCandidateTechnicians(
    ticket?.subcategoryId,
    ticket?.pincode
  );
  const assign = useAssignTicket();

  const [pending, setPending] = useState<string | null>(null);

  function onAssign(tech: Technician) {
    if (!ticket) return;
    setPending(tech.id);
    assign.mutate(
      { id: ticket.id, technicianId: tech.id, technicianName: tech.name },
      {
        // Assignment is not wired to the API yet, so this never runs — the
        // rejection is surfaced below and by the global toaster. Kept so the
        // page needs no rework when the slice lands.
        onSuccess: () => {
          toast.add({ title: `${tech.name} assigned to ${ticket.code}` });
          navigate(`/tickets/${ticket.id}`);
        },
        onSettled: () => setPending(null),
      }
    );
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
