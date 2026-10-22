import { useState } from "react";
import { ArrowLeft, Building2, TriangleAlert } from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { ClaimPaymentForm } from "@/components/redemptions/ClaimPaymentForm";
import { DeclineRedemptionDialog } from "@/components/redemptions/DeclineRedemptionDialog";
import { RedemptionBadge } from "@/components/redemptions/RedemptionBadge";
import { LinkButton } from "@/components/shared/LinkButton";
import { Notice } from "@/components/shared/Notice";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { QrCode } from "@/components/shared/QrCode";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavOrigin, readNavOrigin } from "@/hooks/useNavOrigin";
import { useRedemption } from "@/hooks/useRedemptions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FRANCHISEE_PARAM } from "@/components/shared/FranchiseePicker";
import type { RedemptionDetail, RedemptionEvent } from "@/types/redemption";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/**
 * One redemption, from the payer's side.
 *
 * The payer's whole job here is two acts on two devices: scan the QR with
 * their OWN phone's UPI app and pay, then come back and say so with the
 * screenshot. Nothing on this page can see the money move — there is no
 * gateway — which is why the page never offers to mark anything paid on its
 * own, and why "settled" only ever arrives from the technician's app.
 *
 * The QR is shown only while nothing has been claimed. After a claim, a QR
 * still on screen is an invitation to pay twice; a payer whose first payment
 * genuinely failed still has the UPI ID printed below to pay again by hand.
 */
export default function RedemptionPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  // The pool this row was read from travels in the URL exactly as the queue
  // left it (§5.10): the staff payer who narrowed to a non-home franchisee
  // reads THAT redemption, and a pasted link lands in the pool it was pasted
  // from.
  const [searchParams] = useSearchParams();
  const franchiseeId = searchParams.get(FRANCHISEE_PARAM);
  const { data, isLoading, isError, error, refetch } = useRedemption(
    id,
    franchiseeId
  );

  const origin = readNavOrigin(location.state);
  // Task 09 — the queue this page answers to is the shell's: the portal mounts
  // the same page under `/franchise/redemptions`, so Back goes there.
  const { paths } = useWorkspace();
  const backHref = origin?.backTo ?? paths.redemptions;
  const backText = origin?.backLabel ?? "Back to redemptions";

  return (
    <>
      <PageMeta
        title={data ? `Redemption ${data.code}` : "Redemption"}
        description="Pay a technician's redemption by UPI and record the proof"
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
          title="Couldn't load this redemption"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !data ? (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <Body redemption={data} origin={origin} />
      )}
    </>
  );
}

function Body({
  redemption: r,
  origin,
}: {
  redemption: RedemptionDetail;
  origin: ReturnType<typeof readNavOrigin>;
}) {
  const [declining, setDeclining] = useState(false);
  // The technician's profile is one more hop; hand it this page's own trail so
  // Back from there returns here, then to the queue (hard rule 11).
  const toTechnician = useNavOrigin("Back to redemption", origin);
  // Task 09 — the profile link lands on the shell's roster.
  const { paths, workspace } = useWorkspace();
  // The row's own act-permission (F8: a non-home franchisee's redemption is
  // paid by ITS admin). It is a STAFF rule — the server computes it as
  // `not principal.is_franchise and row.franchisee_id == home_id`, so on the
  // portal's own rows it reads false although the franchisee admin's write
  // door is exactly the one that works. Only the ops console obeys it.
  const canAct = workspace === "ops" ? r.canAct : true;
  // The claim form, before anybody has said they paid — and again only once
  // the technician has said "not yet". Straight after a claim it would sit
  // under "Waiting for…" inviting the payer to pay a second time.
  //
  // §5.10 — `canAct` stands between the two buttons and the door: for staff
  // reading another pool the acts vanish rather than sit behind a 404.
  const canClaim =
    canAct &&
    (r.state === "to_pay" || (r.state === "awaiting" && r.deniedAt !== null));

  // A row the reader cannot act on is named, not silent — "no button, no
  // explanation" reads as a bug rather than a boundary, which is why the
  // banner stands where the Mark as paid card would. Only a staff reader on a
  // non-home pool ever sees it.
  const showManagedBy = workspace === "ops" && !canAct;

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-2">
      <div className="flex flex-col gap-3.5">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2.5">
              <RedemptionBadge state={r.state} />
              <span className="font-mono text-xs text-ink-3">{r.code}</span>
            </div>
            <CardTitle className="mt-2 text-3xl font-bold tabular-nums">
              {moneyPaise(r.amountPaise)}
            </CardTitle>
            <CardDescription className="text-sm text-ink-2">
              <Link
                to={paths.technician(r.technicianId)}
                state={toTechnician}
                className="font-medium text-ink hover:underline"
              >
                {r.technicianName}
              </Link>{" "}
              <span className="font-mono text-xs text-ink-3">
                {r.technicianCode}
              </span>
              {r.technicianPhone ? (
                <span className="text-ink-3"> · {r.technicianPhone}</span>
              ) : null}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col items-center gap-4 py-2">
            {r.state === "to_pay" && r.upiUri ? (
              <>
                <QrCode
                  value={r.upiUri}
                  label={`UPI QR code to pay ${moneyPaise(r.amountPaise)} to ${r.payeeName}, ${r.upiId}`}
                />
                <p className="max-w-sm text-center text-[13px] leading-relaxed text-ink-2">
                  Scan with any UPI app. Check the name it shows is{" "}
                  {/* The name ON THE UPI ACCOUNT, frozen on the redemption — it is
                      what the payer's app will show, which the technician's own
                      name may not be. */}
                  <span className="font-semibold text-ink">{r.payeeName}</span>{" "}
                  before you pay.
                </p>
              </>
            ) : null}

            <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-ink-3">UPI ID</dt>
              <dd className="font-mono break-all select-all">{r.upiId}</dd>
              <dt className="text-ink-3">Reference</dt>
              <dd className="font-mono">{r.code}</dd>
              <dt className="text-ink-3">Requested</dt>
              <dd>{formatDateTime(r.requestedAt)}</dd>
            </dl>
          </CardContent>
        </Card>

        {r.events.length ? (
          <Card>
            <CardContent className="py-1">
              <ol className="flex flex-col gap-2 text-[13px]">
                {r.events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-4">
                    <span>{eventLabel(e)}</span>
                    <span className="shrink-0 text-ink-3">{formatDateTime(e.at)}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="flex flex-col gap-3.5">
        {/* §5.10 PROPOSED copy, used as given. It names WHO works the money and
            what this reader can still do, in one sentence — the queue's own
            words, not a generic "you don't have permission". */}
        {showManagedBy ? (
          <Notice tone="warn" icon={Building2} title={`Managed by ${r.franchiseeName}.`}>
            Its own franchisee admin pays this one; you can read it. No Mark as
            paid, no Decline.
          </Notice>
        ) : null}

        {r.deniedAt ? (
          <p
            role="status"
            className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-[13px] leading-relaxed text-warn"
          >
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            {r.technicianName} says it hasn&apos;t arrived ({formatDateTime(r.deniedAt)})
          </p>
        ) : null}

        {r.claimedAt ? (
          <Card>
            <CardContent className="flex flex-col gap-3 py-1">
              <p className="text-sm font-semibold">
                Paid by {r.claimedBy ?? "—"} · {formatDateTime(r.claimedAt)}
              </p>
              {r.utr ? (
                <p className="font-mono text-xs text-ink-2 select-all">UTR {r.utr}</p>
              ) : null}
              {r.proofUrl ? (
                <a href={r.proofUrl} target="_blank" rel="noreferrer" className="self-start">
                  <img
                    src={r.proofUrl}
                    alt={`Payment screenshot for ${r.code}`}
                    width={180}
                    height={320}
                    loading="lazy"
                    decoding="async"
                    className="h-80 w-45 rounded-md border border-line bg-surface-2 object-contain"
                  />
                </a>
              ) : null}
              {r.state === "awaiting" ? (
                <p className="text-[13px] text-ink-2">
                  Waiting for {r.technicianName} to confirm
                </p>
              ) : null}
              {r.confirmedAt ? (
                <p className="text-[13px] font-medium text-ok">
                  Received · {formatDateTime(r.confirmedAt)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {r.declinedAt ? (
          <Card>
            <CardContent className="py-1 text-[13px] leading-relaxed">
              Declined by {r.declinedBy ?? "—"}: {r.declineReason ?? "—"}
            </CardContent>
          </Card>
        ) : null}

        {canClaim ? (
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-[15px] font-semibold">Mark as paid</CardTitle>
            </CardHeader>
            <CardContent className="py-1">
              <ClaimPaymentForm redemptionId={r.id} />
            </CardContent>
          </Card>
        ) : null}

        {/* Only before a claim — the server refuses it afterwards, because the
            money may already have moved. And only a payer of THIS pool: see
            `canAct`. */}
        {r.state === "to_pay" && canAct ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => setDeclining(true)}
          >
            Decline
          </Button>
        ) : null}
      </div>

      <DeclineRedemptionDialog
        open={declining}
        onOpenChange={setDeclining}
        redemption={r}
      />
    </div>
  );
}

/** The trail, in the words the rest of the page — and the app — already use. */
function eventLabel(e: RedemptionEvent): string {
  switch (e.kind) {
    case "requested":
      return "Requested";
    case "claimed":
      return `Paid by ${e.actorLabel ?? "—"}${e.utr ? ` · UTR ${e.utr}` : ""}`;
    case "denied":
      return "Not yet";
    case "confirmed":
      return "Received";
    case "declined":
      return `Declined by ${e.actorLabel ?? "—"}`;
  }
}
