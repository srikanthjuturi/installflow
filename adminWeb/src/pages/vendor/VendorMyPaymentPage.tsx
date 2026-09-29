import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { PaymentProofForm } from "@/components/shared/PaymentProofForm";
import { ErrorState } from "@/components/shared/states";
import { UpiQr } from "@/components/shared/UpiQr";
import { VendorPaymentBadge } from "@/components/vendorCredit/VendorCreditBadges";
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
import { readNavOrigin } from "@/hooks/useNavOrigin";
import {
  useCancelMyPayment,
  useClaimMyPayment,
  useMyVendorPayment,
} from "@/hooks/useVendorCredits";
import type { VendorPaymentDetail } from "@/types/vendorCredit";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/**
 * One payment, from the vendor's side.
 *
 * Two acts on two devices: scan the QR with a phone's UPI app and pay, then come
 * back and say so with the reference and the screenshot. Nothing here can see the
 * money move — there is no gateway — so the limit is restored only when somebody
 * at the company confirms it arrived, and this page says so rather than
 * pretending otherwise.
 *
 * The QR is shown only while nothing has been claimed: after that, a QR still on
 * screen is an invitation to pay twice.
 */
export default function VendorMyPaymentPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { data, isLoading, isError, error, refetch } = useMyVendorPayment(id);

  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/portal/credit";
  const backText = origin?.backLabel ?? "Back to credit";

  return (
    <>
      <PageMeta
        title={data ? `Payment ${data.code}` : "Payment"}
        description="Pay by UPI and send the reference"
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
          title="Couldn't load this payment"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !data ? (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <Body payment={data} />
      )}
    </>
  );
}

function Body({ payment: p }: { payment: VendorPaymentDetail }) {
  const claim = useClaimMyPayment();
  const cancel = useCancelMyPayment();
  const [cancelling, setCancelling] = useState(false);

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-2">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2.5">
            <VendorPaymentBadge state={p.state} />
            <span className="font-mono text-xs text-ink-3">{p.code}</span>
          </div>
          <CardTitle className="mt-2 text-3xl font-bold tabular-nums">
            {moneyPaise(p.amountPaise)}
          </CardTitle>
          <CardDescription className="text-sm text-ink-2">
            to {p.payeeName}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col items-center gap-4 py-2">
          {p.state === "to_pay" && p.upiUri ? (
            <>
              <UpiQr
                value={p.upiUri}
                label={`UPI QR code to pay ${moneyPaise(p.amountPaise)} to ${p.payeeName}, ${p.upiId}`}
              />
              <p className="max-w-sm text-center text-[13px] leading-relaxed text-ink-2">
                Scan with any UPI app. Check the name it shows is{" "}
                <span className="font-semibold text-ink">{p.payeeName}</span>{" "}
                before you pay.
              </p>
            </>
          ) : null}

          <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-ink-3">UPI ID</dt>
            <dd className="font-mono break-all select-all">{p.upiId}</dd>
            <dt className="text-ink-3">Reference</dt>
            <dd className="font-mono">{p.code}</dd>
            <dt className="text-ink-3">Started</dt>
            <dd>
              {formatDateTime(p.createdAt)}
              {p.requestedByLabel ? ` · ${p.requestedByLabel}` : ""}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3.5">
        {p.state === "to_pay" ? (
          <>
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-[15px] font-semibold">
                  I&apos;ve paid
                </CardTitle>
                <CardDescription className="text-[13px] leading-relaxed">
                  Your limit goes back up when the company confirms it arrived.
                </CardDescription>
              </CardHeader>
              <CardContent className="py-1">
                <PaymentProofForm
                  idPrefix="vendor-payment"
                  utrRequired
                  utrLabel="UTR / reference ID"
                  submitLabel="Submit payment"
                  pending={claim.isPending}
                  onSubmit={async ({ proof, utr }) => {
                    await claim.mutateAsync({ id: p.id, utr, proof });
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
              Withdraw payment
            </Button>
          </>
        ) : null}

        {p.claimedAt ? (
          <Card>
            <CardContent className="flex flex-col gap-3 py-1">
              <p className="text-sm font-semibold">
                Sent by {p.claimedByLabel ?? "—"} ·{" "}
                {formatDateTime(p.claimedAt)}
              </p>
              {p.utr ? (
                <p className="font-mono text-xs text-ink-2 select-all">
                  UTR {p.utr}
                </p>
              ) : null}
              {p.proofUrl ? (
                <a
                  href={p.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="self-start"
                >
                  <img
                    src={p.proofUrl}
                    alt={`Payment screenshot for ${p.code}`}
                    width={180}
                    height={320}
                    loading="lazy"
                    decoding="async"
                    className="h-80 w-45 rounded-md border border-line bg-surface-2 object-contain"
                  />
                </a>
              ) : null}
              {p.state === "waiting" ? (
                <p className="text-[13px] text-ink-2">
                  Waiting for the company to confirm it arrived.
                </p>
              ) : null}
              {p.confirmedAt ? (
                <p className="text-[13px] font-medium text-ok">
                  Confirmed · {formatDateTime(p.confirmedAt)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {p.rejectedAt ? (
          <Card>
            <CardContent className="flex flex-col gap-1.5 py-1 text-[13px] leading-relaxed">
              <p>Not accepted: {p.rejectReason ?? "—"}</p>
              {/* A rejection is final and the money may already have left, so
                  say how to resubmit without paying a second time. */}
              <p className="text-ink-3">
                Already paid? Start a new payment for the same amount and send
                the same UTR — don&apos;t pay again.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {p.cancelledAt ? (
          <Card>
            <CardContent className="py-1 text-[13px] text-ink-2">
              Withdrawn · {formatDateTime(p.cancelledAt)}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Withdraw ${p.code}?`}
        description="Only if you haven't paid it. You can start another payment afterwards."
        confirmLabel="Withdraw payment"
        cancelLabel="Keep it"
        isPending={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(p.id, {
            onSuccess: () => {
              toast.add({ title: `${p.code} withdrawn` });
              setCancelling(false);
            },
          })
        }
      />
    </div>
  );
}
