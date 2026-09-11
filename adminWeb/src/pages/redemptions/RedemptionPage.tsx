import { useState } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";
import { ClaimPaymentForm } from "@/components/redemptions/ClaimPaymentForm";
import { DeclineRedemptionDialog } from "@/components/redemptions/DeclineRedemptionDialog";
import { RedemptionBadge } from "@/components/redemptions/RedemptionBadge";
import { UpiQr } from "@/components/redemptions/UpiQr";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
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
  const { data, isLoading, isError, error, refetch } = useRedemption(id);

  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/redemptions";
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
  // The claim form, before anybody has said they paid — and again only once
  // the technician has said "not yet". Straight after a claim it would sit
  // under "Waiting for…" inviting the payer to pay a second time.
  const canClaim =
    r.state === "to_pay" || (r.state === "awaiting" && r.deniedAt !== null);

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-2">
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
              to={`/technicians/${r.technicianId}`}
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
              <UpiQr
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

      <div className="flex flex-col gap-3.5">
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
            money may already have moved. */}
        {r.state === "to_pay" ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => setDeclining(true)}
          >
            Decline
          </Button>
        ) : null}

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
