import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { ApprovePartDialog } from "@/components/parts/ApprovePartDialog";
import { IssuePartDialog } from "@/components/parts/IssuePartDialog";
import { PartRequestDetail } from "@/components/parts/PartRequestDetail";
import { RejectPartDialog } from "@/components/parts/RejectPartDialog";
import { ReturnPartDialog } from "@/components/parts/ReturnPartDialog";
import { noteOrNull } from "@/components/parts/partSchemas";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import { readNavOrigin, useNavOrigin } from "@/hooks/useNavOrigin";
import {
  useApprovePartRequest,
  useIssuePartRequest,
  usePartRequest,
  useRejectPartRequest,
  useReturnPartRequest,
} from "@/hooks/useParts";
import type { PartAction } from "@/types/parts";

/**
 * One part request — `/franchise/parts/requests/:id` (Task 13 §5.7).
 *
 * The page owns the ONE open dialog (the `EscalationQueuePage` rule) and every
 * mutation, and closes a dialog on success only: a refusal — two tabs approving
 * the same request, a 409 `PART_REQUEST_BAD_STATE` — is the toaster's to report,
 * and the hook refetches so the buttons show the truth underneath it.
 *
 * "Back" is never hard-coded (rule 11): the queue hands over where it was,
 * filters and page included; a pasted link carries nothing and falls back to the
 * queue. The ticket link forwards this page as the next origin.
 *
 * A hand-typed URL on a session that may not handle parts gets the server's own
 * 403 sentence from `ErrorState` — nothing here invents one.
 */
export default function PartRequestPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/franchise/parts";
  const backText = origin?.backLabel ?? "Back to spare parts";
  // What the ticket link hands on: come back HERE, and here is how to get out.
  const ticketOrigin = useNavOrigin("Back to request", origin);

  const { data: request, isLoading, isError, error, refetch } = usePartRequest(id);
  const { has } = useFeatureAccess();
  const canHandle = has("parts.handle");

  const [dialog, setDialog] = useState<PartAction | null>(null);
  const close = () => setDialog(null);

  const approve = useApprovePartRequest();
  const reject = useRejectPartRequest();
  const issue = useIssuePartRequest();
  const returned = useReturnPartRequest();

  return (
    <>
      <PageMeta
        title={request ? `${request.code} · Spare part request` : "Spare part request"}
        description="Spare part request"
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
          /* A 404 also lands here — "not yours" is the honest wording either
             way (hard rule 0), and a 403 carries the server's own sentence. */
          title="Couldn't load the request"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !request ? (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
          </div>
        </div>
      ) : (
        <PartRequestDetail
          request={request}
          canHandle={canHandle}
          onAction={setDialog}
          ticketOrigin={ticketOrigin}
        />
      )}

      {/* Mounted only while open, so each starts clear (a tick, a reason or a
          photo never outlives the request it was typed for). */}
      {request && dialog === "approve" ? (
        <ApprovePartDialog
          open
          onOpenChange={(next) => !next && close()}
          request={request}
          isPending={approve.isPending}
          onConfirm={({ addToCatalogue }) =>
            approve.mutate(
              { id: request.id, addToCatalogue },
              {
                onSuccess: () => {
                  toast.add({ title: "Request approved" });
                  close();
                },
              }
            )
          }
        />
      ) : null}

      {request && dialog === "reject" ? (
        <RejectPartDialog
          open
          onOpenChange={(next) => !next && close()}
          request={request}
          isPending={reject.isPending}
          onConfirm={({ reason }) =>
            reject.mutate(
              { id: request.id, reason },
              {
                onSuccess: () => {
                  toast.add({
                    title:
                      request.status === "approved"
                        ? "Approval cancelled"
                        : "Request rejected",
                  });
                  close();
                },
              }
            )
          }
        />
      ) : null}

      {request && dialog === "issue" ? (
        <IssuePartDialog
          open
          onOpenChange={(next) => !next && close()}
          request={request}
          isPending={issue.isPending}
          onConfirm={({ note }) =>
            issue.mutate(
              { id: request.id, note: noteOrNull(note) },
              {
                onSuccess: () => {
                  toast.add({ title: "Part issued" });
                  close();
                },
              }
            )
          }
        />
      ) : null}

      {request && dialog === "return" ? (
        <ReturnPartDialog
          open
          onOpenChange={(next) => !next && close()}
          request={request}
          isPending={returned.isPending}
          onConfirm={({ note, photoBlobName }) =>
            returned.mutate(
              { id: request.id, note: noteOrNull(note), photoBlobName },
              {
                onSuccess: () => {
                  toast.add({ title: "Return logged" });
                  close();
                },
              }
            )
          }
        />
      ) : null}
    </>
  );
}
