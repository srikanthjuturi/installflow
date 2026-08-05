import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { ForceCloseForm } from "@/components/tickets/ForceCloseForm";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useForceCloseTicket, useTicket } from "@/hooks/useTickets";

export default function ForceClosePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: ticket, isLoading, isError, error, refetch } = useTicket(id);
  const forceClose = useForceCloseTicket();

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
            isSubmitting={forceClose.isPending}
            onSubmit={(values) =>
              forceClose.mutate(
                { id: ticket.id, ...values },
                {
                  onSuccess: (closed) => {
                    toast.add({
                      title: `${closed.id} force-closed`,
                      description:
                        "Reason, notes and attachments recorded for audit.",
                    });
                    navigate(`/tickets/${closed.id}`);
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
