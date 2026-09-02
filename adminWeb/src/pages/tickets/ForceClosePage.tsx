import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { ForceCloseForm } from "@/components/tickets/ForceCloseForm";
import type { ForceCloseFormValues } from "@/components/tickets/ForceCloseForm";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { originFor, readNavOrigin } from "@/hooks/useNavOrigin";
import { describeError } from "@/lib/apiError";
import { useForceCloseTicket, useTicket } from "@/hooks/useTickets";
import type { ForceCloseAttachment } from "@/services/tickets";
import { uploadImage } from "@/services/uploads";
import { isTerminalTicketStatus } from "@/types";

export default function ForceClosePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    data: ticket,
    isLoading,
    isError,
    error: loadError,
    refetch,
  } = useTicket(id);
  const forceClose = useForceCloseTicket();

  /**
   * An upload that failed, kept separately from the mutation's own error.
   *
   * The files go up BEFORE the closure is sent, so a network drop mid-upload
   * leaves nothing closed and the form still holding the files. That is the
   * right way round — a closure recorded with half its evidence would be worse
   * than one that has to be retried — but it means the failure belongs to this
   * page rather than to the mutation, which never ran.
   */
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const busy = uploading || forceClose.isPending;
  const error = uploadError ?? (forceClose.isError ? forceClose.error : null);

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

  /**
   * Upload the evidence, then close the ticket.
   *
   * In that order, and never the other way round. The API takes blob NAMES —
   * the files are private and land in their own container first — so a closure
   * sent before the uploads finished would be a closure with no evidence behind
   * it, which is the one thing this screen exists to prevent. If any upload
   * fails, nothing is closed and the form keeps the files for a retry.
   *
   * Sequential rather than `Promise.all`: this is at most ten files, and a
   * partial failure is far easier to report when it is the first one that
   * stopped rather than three of ten in an unknown order.
   */
  async function submit(
    current: NonNullable<typeof ticket>,
    values: ForceCloseFormValues
  ) {
    setUploadError(null);
    setUploading(true);
    const attachments: ForceCloseAttachment[] = [];
    try {
      for (const file of values.attachments) {
        attachments.push({
          blobName: await uploadImage(file, "attachment"),
          fileName: file.name,
        });
      }
    } catch (err) {
      setUploadError(err);
      // The toaster too, not only the panel — hard rule 9. This failure never
      // reaches the query cache's global handler, because the mutation has not
      // run: the upload is a bare call this page makes itself, so nothing else
      // would report it.
      const { title, description } = describeError(
        err,
        "Couldn't upload the attachments"
      );
      toast.add({ title, description });
      return;
    } finally {
      setUploading(false);
    }

    forceClose.mutate(
      {
        id: current.id,
        reason: values.reason,
        notes: values.notes,
        attachments,
      },
      {
        onSuccess: () => {
          toast.add({
            title: `${current.code} force-closed`,
            description: "Reason, notes and attachments recorded for audit.",
          });
          navigate(ticketPath, { state: originFor(ticketPath, origin) });
        },
      }
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
          error={loadError}
          onRetry={() => refetch()}
        />
      ) : isLoading || !ticket ? (
        <div className="flex max-w-3xl flex-col gap-3.5">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <>
          {/* The API rejects an empty attachment list with a 422 and a settled
              ticket with a 409; the form and the redirect above block both, so
              this covers a genuine failure — including an upload that did not
              land, which is reported here rather than in the toaster because
              the form is still on screen and still holds the files. */}
          {error ? (
            <div className="mb-3.5 max-w-3xl">
              <ErrorState
                title="Couldn't force-close this ticket"
                error={error}
                onRetry={() => {
                  setUploadError(null);
                  forceClose.reset();
                }}
              />
            </div>
          ) : null}

          <ForceCloseForm
            ticketId={ticket.id}
            cancelState={originFor(ticketPath, origin)}
            isSubmitting={busy}
            onSubmit={(values) => void submit(ticket, values)}
          />
        </>
      )}
    </>
  );
}
