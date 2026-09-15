import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { RechargeBadge } from "@/components/credits/RechargeBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { PaymentProofForm } from "@/components/shared/PaymentProofForm";
import { ErrorState } from "@/components/shared/states";
import { UpiQr } from "@/components/shared/UpiQr";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useCancelRecharge, useClaimRecharge, useRecharge } from "@/hooks/useCredits";
import { readNavOrigin } from "@/hooks/useNavOrigin";
import type { RechargeDetail } from "@/types/credits";
import { formatCredits } from "@/utils/credits";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/**
 * One recharge, from the company's side.
 *
 * Two acts on two devices: scan the QR with a phone's UPI app and pay, then
 * come back and say so with the UTR and the screenshot. Nothing here can see
 * the money move — there is no gateway — so the credits arrive only when the
 * superadmin confirms, and this page says so rather than pretending otherwise.
 *
 * The QR is shown only while nothing has been claimed: after that, a QR still
 * on screen is an invitation to pay twice.
 */
export default function RechargePage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { data, isLoading, isError, error, refetch } = useRecharge(id);

  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/credits";
  const backText = origin?.backLabel ?? "Back to credits";

  return (
    <>
      <PageMeta
        title={data ? `Recharge ${data.code}` : "Recharge"}
        description="Pay for credits by UPI and submit the proof"
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
          title="Couldn't load this recharge"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !data ? (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <Body recharge={data} />
      )}
    </>
  );
}

function Body({ recharge: r }: { recharge: RechargeDetail }) {
  const claim = useClaimRecharge();
  const cancel = useCancelRecharge();
  const [cancelling, setCancelling] = useState(false);

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-2">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2.5">
            <RechargeBadge state={r.state} />
            <span className="font-mono text-xs text-ink-3">{r.code}</span>
          </div>
          <CardTitle className="mt-2 text-3xl font-bold tabular-nums">
            {moneyPaise(r.amountPaise)}
          </CardTitle>
          <CardDescription className="text-sm text-ink-2">
            {formatCredits(r.credits)} credits
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
                <span className="font-semibold text-ink">{r.payeeName}</span> before
                you pay.
              </p>
            </>
          ) : null}

          <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-ink-3">UPI ID</dt>
            <dd className="font-mono break-all select-all">{r.upiId}</dd>
            <dt className="text-ink-3">Reference</dt>
            <dd className="font-mono">{r.code}</dd>
            <dt className="text-ink-3">Requested</dt>
            <dd>
              {formatDateTime(r.requestedAt)}
              {r.requestedBy ? ` · ${r.requestedBy}` : ""}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3.5">
        {r.state === "to_pay" ? (
          <>
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-[15px] font-semibold">I&apos;ve paid</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <PaymentProofForm
                  idPrefix="recharge"
                  utrRequired
                  utrLabel="UTR / reference ID"
                  submitLabel="Submit payment"
                  pending={claim.isPending}
                  onSubmit={async ({ proof, utr }) => {
                    await claim.mutateAsync({ id: r.id, utr, proof });
                    toast.add({ title: "Payment submitted" });
                  }}
                />
              </CardContent>
            </Card>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setCancelling(true)}
            >
              Cancel recharge
            </Button>
          </>
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
              {r.state === "waiting" ? (
                <p className="text-[13px] text-ink-2">Waiting for confirmation</p>
              ) : null}
              {r.confirmedAt ? (
                <p className="text-[13px] font-medium text-ok">
                  Credited · {formatDateTime(r.confirmedAt)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {r.rejectedAt ? (
          <Card>
            <CardContent className="flex flex-col gap-1.5 py-1 text-[13px] leading-relaxed">
              <p>Not approved: {r.rejectReason ?? "—"}</p>
              {/* A rejection is final, and the money may already have left —
                  so say how to resubmit without paying a second time. */}
              <p className="text-ink-3">
                Already paid? Start a new recharge for the same amount and submit
                the same UTR — don&apos;t pay again.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {r.cancelledAt ? (
          <Card>
            <CardContent className="py-1 text-[13px] text-ink-2">
              Cancelled · {formatDateTime(r.cancelledAt)}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${r.code}?`}
        description="Only if you haven't paid it. You can start a new recharge afterwards."
        confirmLabel="Cancel recharge"
        cancelLabel="Keep it"
        isPending={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(r.id, {
            onSuccess: () => {
              toast.add({ title: `${r.code} cancelled` });
              setCancelling(false);
            },
          })
        }
      />
    </div>
  );
}
