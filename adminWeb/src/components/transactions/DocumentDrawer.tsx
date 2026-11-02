import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { useResendEmails, useTransactionDocument } from "@/hooks/useTransactions";
import {
  PARTY_KIND_LABELS,
  SURFACE_CAPS,
  amountColumns,
  type TransactionDocument,
  type TransactionSurface,
} from "@/types/transaction";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";
import { DocTypeBadge, EmailStatusBadge } from "./badges";
import { ticketPathFor } from "./surface";

/**
 * One document, in a panel down the right-hand edge (a dialog pinned to the
 * edge - the console has no sheet primitive). Everything the row hides is
 * here: the note, the proof, the document it relates to and the ticket.
 *
 * "Re-send" appears on the company and platform surfaces only; it re-queues
 * this one document for the company's Admins, it does not email anything
 * inline.
 */
export function DocumentDrawer({
  surface,
  doc,
  onClose,
  onOpenRelated,
}: {
  surface: TransactionSurface;
  doc: TransactionDocument | null;
  onClose: () => void;
  onOpenRelated: (doc: TransactionDocument) => void;
}) {
  return (
    <Dialog open={doc !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        // Pinned to the right edge, full height. `cn` resolves the centring
        // classes the dialog ships with in favour of these.
        className="top-0 right-0 left-auto h-full w-full max-w-md translate-x-0 translate-y-0 overflow-y-auto rounded-none p-5 sm:max-w-md"
      >
        {doc ? (
          <DrawerBody
            surface={surface}
            doc={doc}
            onOpenRelated={onOpenRelated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-line-2 py-2 text-[13px]">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function DrawerBody({
  surface,
  doc,
  onOpenRelated,
}: {
  surface: TransactionSurface;
  doc: TransactionDocument;
  onOpenRelated: (doc: TransactionDocument) => void;
}) {
  const caps = SURFACE_CAPS[surface];
  const origin = useNavOrigin("Back to transactions");
  const related = useTransactionDocument(doc.relatedDocumentId);
  const resend = useResendEmails();
  const [previewFailed, setPreviewFailed] = useState(false);
  const cols = amountColumns(doc);
  const ticketTo = doc.ticketId ? ticketPathFor(surface, doc.ticketId) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-mono">{doc.number}</DialogTitle>
        <DialogDescription>
          <span className="inline-flex items-center gap-2">
            <DocTypeBadge type={doc.docType} />
            {formatDateTime(doc.issuedAt)}
          </span>
        </DialogDescription>
      </DialogHeader>

      <div
        className="rounded-lg border border-line bg-surface-2 px-3.5 py-3"
        aria-label="Amount"
      >
        <div className="text-xs text-ink-3">
          {doc.effect === "debit" ? "Debit" : "Credit"}
        </div>
        <div className="mt-1 text-[26px] leading-none font-semibold tabular-nums">
          {moneyPaise(cols.debitPaise ?? cols.creditPaise)}
        </div>
        <div className="mt-1.5 text-xs text-ink-3">
          {doc.effect === "debit"
            ? "Raises what the party owes the company"
            : "Reduces what the party owes the company"}
        </div>
      </div>

      <dl>
        {surface === "superadmin" ? <Row label="Company">{doc.companyName}</Row> : null}
        <Row label="Party">
          {doc.partyLabel}{" "}
          <span className="text-ink-3">· {PARTY_KIND_LABELS[doc.partyKind]}</span>
        </Row>
        <Row label="Details">{doc.description}</Row>
        {doc.note ? <Row label="Note">{doc.note}</Row> : null}
        {doc.ticketCode ? (
          <Row label="Ticket">
            {ticketTo ? (
              <Link
                to={ticketTo}
                state={origin}
                className="font-mono text-brand-500 hover:underline"
              >
                {doc.ticketCode}
              </Link>
            ) : (
              <span className="font-mono">{doc.ticketCode}</span>
            )}
          </Row>
        ) : null}
        {doc.proofReference ? (
          <Row label="Reference">
            <span className="font-mono">{doc.proofReference}</span>
          </Row>
        ) : null}
        {doc.relatedDocumentId ? (
          <Row label="Related document">
            {related.isLoading ? (
              <Skeleton className="h-4 w-28" />
            ) : related.data ? (
              <button
                type="button"
                onClick={() => related.data && onOpenRelated(related.data)}
                className="font-mono text-brand-500 hover:underline"
              >
                {related.data.number}
              </button>
            ) : (
              <span className="text-ink-3">Not available</span>
            )}
          </Row>
        ) : null}
        {caps.email ? (
          <Row label="Email">
            <span className="inline-flex flex-wrap items-center gap-2">
              <EmailStatusBadge status={doc.emailStatus} />
              {doc.emailedAt ? (
                <span className="text-xs text-ink-3">{formatDateTime(doc.emailedAt)}</span>
              ) : null}
            </span>
          </Row>
        ) : null}
      </dl>

      {doc.proofUrl ? (
        <div className="grid gap-2">
          <div className="text-xs font-medium text-ink-2">Proof</div>
          {previewFailed ? null : (
            <img
              src={doc.proofUrl}
              alt={`Proof for ${doc.number}`}
              className="max-h-56 w-full rounded-lg border border-line object-contain"
              onError={() => setPreviewFailed(true)}
            />
          )}
          <a
            href={doc.proofUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-500 hover:underline"
          >
            Open proof
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      ) : null}

      {caps.email ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={resend.isPending}
            onClick={() =>
              resend.mutate(
                {
                  documentId: doc.id,
                  // The superadmin names the company; a company's own Admin
                  // never sends one (hard rule 0).
                  ...(surface === "superadmin" ? { companyId: doc.companyId } : {}),
                },
                {
                  onSuccess: (r) =>
                    toast.add({
                      title: `${r.queued} ${r.queued === 1 ? "document" : "documents"} queued`,
                      description: "They will be emailed to the company's Admins within minutes.",
                    }),
                }
              )
            }
          >
            <Mail data-icon="inline-start" aria-hidden />
            Re-send
          </Button>
        </div>
      ) : null}
    </>
  );
}
