import { ArrowLeft } from "lucide-react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { ForceCloseForm } from "@/components/tickets/ForceCloseForm";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { originFor, readNavOrigin } from "@/hooks/useNavOrigin";
import { useForceCloseTicket, useTicket } from "@/hooks/useTickets";
import { isTerminalTicketStatus } from "@/types";

export default function ForceClosePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);
  const forceClose = useForceCloseTicket();

  /* Only the ticket links here, so the fallback is the whole story today. The
     origin is read anyway because it carries the trail BEHIND the ticket — see
     `NavOrigin.backState` — so returning to the ticket restores the queue or
     the ledger the reader actually came from. */
  const origin = readNavOrigin(location.state);
  const ticketPath = `/tickets/${id}`;
  const backHref = origin?.backTo ?? ticketPath;
  const backText = origin?.backLabel ?? "Back to ticket";

  // The detail screen stops offering this once a ticket settles, but the URL
  // outlives the button — a bookmark, a second tab, a link in a chat. Sending
  // them to the ticket answers the question rather than asking it: the status
  // badge is the first thing on that page, and the actions are gone for the
  // same reason. Silent and `replace`, like the other dead ticket paths in
  // `routes.tsx`; a notice here would be copy the prototype never wrote.
  //
  // After the load check, never during it: `ticket` is undefined on the first
  // render, and treating that as "still open" is the safe way round.
  if (ticket && isTerminalTicketStatus(ticket.status)) {
    return (
      <Navigate to={ticketPath} replace state={originFor(ticketPath, origin)} />
    );
  }

  return (
    <>
      <PageMeta
        title="Force closure"
        description="Manager closure with a recorded reason, justification and attachments."
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
          title="Couldn't load this ticket"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !ticket ? (
        <div className="flex max-w-3xl flex-col gap-3.5">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <>
          {/* The service rejects an empty attachment list with a 422; the form
              also blocks it, so this covers a genuine failure. */}
          {forceClose.isError ? (
            <div className="mb-3.5 max-w-3xl">
              <ErrorState
                title="Couldn't force-close this ticket"
                error={forceClose.error}
                onRetry={() => forceClose.reset()}
              />
            </div>
          ) : null}

          <ForceCloseForm
            ticketId={ticket.id}
            cancelState={originFor(ticketPath, origin)}
            isSubmitting={forceClose.isPending}
            onSubmit={(values) =>
              forceClose.mutate(
                { id: ticket.id, ...values },
                {
                  // Force-closing is not wired to the API yet, so this never
                  // runs — the rejection is surfaced by the global toaster
                  // instead. Kept so the page needs no rework when it lands.
                  onSuccess: () => {
                    toast.add({
                      title: `${ticket.code} force-closed`,
                      description:
                        "Reason, notes and attachments recorded for audit.",
                    });
                    navigate(ticketPath, {
                      state: originFor(ticketPath, origin),
                    });
                  },
                }
              )
            }
          />
        </>
      )}
    </>
  );
}
