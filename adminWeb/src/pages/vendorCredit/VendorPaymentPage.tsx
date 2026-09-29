import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { useLocation, useParams } from "react-router";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { RejectVendorCreditDialog } from "@/components/vendorCredit/RejectVendorCreditDialog";
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
  useConfirmVendorPayment,
  useRejectVendorPayment,
  useVendorPayment,
} from "@/hooks/useVendorCredits";
import type { VendorPaymentDetail } from "@/types/vendorCredit";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/**
 * One vendor payment, from the company's side — the decision.
 *
 * Nothing here can see the money move: there is no gateway. The vendor says it
 * paid and attaches a screenshot and a UTR; somebody with the bank account open
 * checks and says whether it arrived. Confirming is the ONE thing that restores
 * that vendor's credit line.
 *
 * There is no QR on this page. Staff are the payee, so a QR would be asking them
 * to pay themselves — the server sends `upiUri` as null here for that reason.
 */
export default function VendorPaymentPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { data, isLoading, isError, error, refetch } = useVendorPayment(id);

  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/vendor-credit?view=payments";
  const backText = origin?.backLabel ?? "Back to vendor credit";

  return (
    <>
      <PageMeta
        title={data ? `Payment ${data.code}` : "Vendor payment"}
        description="Check the reference against your statement, then confirm or reject"
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
  const confirm = useConfirmVendorPayment();
  const reject = useRejectVendorPayment();
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);

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
            from {p.vendorName ?? "a vendor"}
          </CardDescription>
        </CardHeader>

        <CardContent className="py-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-ink-3">How</dt>
            <dd>
              {p.source === "staff"
                ? `${p.method ?? "Recorded"} · recorded from your own records`
                : "UPI · the vendor paid a QR and claimed it"}
            </dd>
            {p.receivedOn ? (
              <>
                <dt className="text-ink-3">Arrived</dt>
                <dd>{p.receivedOn}</dd>
              </>
            ) : null}
            {p.note ? (
              <>
                <dt className="text-ink-3">Note</dt>
                <dd>{p.note}</dd>
              </>
            ) : null}
            {/* Only the QR flow has a payee. A NEFT went to no UPI address, and
                printing one would assert a route the money never took. */}
            {p.upiId ? (
              <>
                <dt className="text-ink-3">Paid to</dt>
                <dd className="break-all">
                  <span className="font-mono select-all">{p.upiId}</span>
                  <span className="text-ink-3"> · {p.payeeName}</span>
                </dd>
              </>
            ) : null}
            <dt className="text-ink-3">Reference</dt>
            <dd className="font-mono">{p.code}</dd>
            <dt className="text-ink-3">Asked</dt>
            <dd>
              {formatDateTime(p.createdAt)}
              {p.requestedByLabel ? ` · ${p.requestedByLabel}` : ""}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3.5">
        {p.source === "vendor" && !p.claimedAt ? (
          <Card>
            <CardContent className="py-1 text-[13px] leading-relaxed text-ink-2">
              The vendor hasn&apos;t said it paid yet. There is nothing to decide
              until it does — and nothing you can do here to hurry it.
            </CardContent>
          </Card>
        ) : null}

        {p.claimedAt ? (
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-[15px] font-semibold">
                {p.source === "staff" ? "What was recorded" : "What the vendor sent"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 py-1">
              <p className="text-sm">
                {p.claimedByLabel ?? "—"} · {formatDateTime(p.claimedAt)}
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
            </CardContent>
          </Card>
        ) : null}

        {p.state === "waiting" ? (
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-[15px] font-semibold">
                Did it arrive?
              </CardTitle>
              <CardDescription className="text-[13px] leading-relaxed">
                Check the UTR against your bank statement. Confirming is the only
                thing that restores this vendor&apos;s credit limit, and it
                can&apos;t be undone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 py-1">
              <Button type="button" onClick={() => setConfirming(true)}>
                <Check data-icon="inline-start" />
                Confirm it arrived
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Outcome payment={p} />
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Confirm ${moneyPaise(p.amountPaise)} arrived?`}
        description={`This credits ${p.vendorName ?? "the vendor"}'s account by ${moneyPaise(p.amountPaise)} and lets them raise tickets again. It can't be undone.`}
        confirmLabel="Yes, it arrived"
        cancelLabel="Not yet"
        isPending={confirm.isPending}
        onConfirm={() =>
          confirm.mutate(p.id, {
            onSuccess: () => {
              toast.add({ title: `${p.code} confirmed` });
              setConfirming(false);
            },
          })
        }
      />

      <RejectVendorCreditDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${p.code}?`}
        description={`${p.vendorName ?? "The vendor"} will see your reason and can start a new payment with the right reference. Nothing is credited, and this is final.`}
        placeholder="e.g. Nothing with this UTR has reached the account — check the reference in your UPI app."
        confirmLabel="Reject payment"
        isPending={reject.isPending}
        onReject={(reason, onSuccess) =>
          reject.mutate(
            { id: p.id, reason },
            {
              onSuccess: () => {
                toast.add({ title: `${p.code} rejected` });
                onSuccess();
              },
            }
          )
        }
      />
    </div>
  );
}

/** What happened, once something has. Renders nothing while nothing has. */
function Outcome({ payment: p }: { payment: VendorPaymentDetail }) {
  if (p.confirmedAt) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-1.5 py-1 text-[13px] leading-relaxed">
          <p className="font-medium text-ok">
            Confirmed · {formatDateTime(p.confirmedAt)}
            {p.confirmedByLabel ? ` · ${p.confirmedByLabel}` : ""}
          </p>
          <p className="text-ink-2">
            {moneyPaise(p.amountPaise)} came off what{" "}
            {p.vendorName ?? "the vendor"} owes.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (p.rejectedAt) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-1.5 py-1 text-[13px] leading-relaxed">
          <p>Rejected: {p.rejectReason ?? "—"}</p>
          <p className="text-ink-3">
            {formatDateTime(p.rejectedAt)}
            {p.rejectedByLabel ? ` · ${p.rejectedByLabel}` : ""}. Nothing was
            credited.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (p.cancelledAt) {
    return (
      <Card>
        <CardContent className="py-1 text-[13px] text-ink-2">
          Withdrawn by the vendor · {formatDateTime(p.cancelledAt)}
        </CardContent>
      </Card>
    );
  }
  return null;
}
