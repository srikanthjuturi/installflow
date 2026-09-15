import { useState } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";
import { RechargeBadge } from "@/components/credits/RechargeBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { RejectRechargeDialog } from "@/components/superadmin/RejectRechargeDialog";
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
import { useConfirmRecharge, usePlatformRecharge } from "@/hooks/usePlatform";
import { trackCreditRechargeConfirmed } from "@/lib/analytics/events";
import { RECHARGE_STATE_LABELS } from "@/types/credits";
import type { PlatformRechargeDetail } from "@/types/platform";
import { formatCredits } from "@/utils/credits";
import { formatDateTime } from "@/utils/datetime";
import { moneyPaise } from "@/utils/money";

/**
 * One recharge, from the platform's side — the proof, and the decision.
 *
 * The superadmin is the only party who can see the money arrive, which is why
 * confirming here is the one thing in the product that adds credits. The page
 * shows what to check it against — the amount, the UTR, the screenshot — and
 * asks once more before adding them.
 */
export default function PlatformRechargePage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { data, isLoading, isError, error, refetch } = usePlatformRecharge(id);

  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/recharges";
  const backText = origin?.backLabel ?? "Back to recharges";

  return (
    <>
      <PageMeta
        title={data ? `Recharge ${data.code}` : "Recharge"}
        description="Check a company's payment and confirm or reject it."
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
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <Body recharge={data} />
      )}
    </>
  );
}

function Body({ recharge: r }: { recharge: PlatformRechargeDetail }) {
  const confirm = useConfirmRecharge();
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);

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
            <span className="font-medium text-ink">{r.companyName}</span>{" "}
            <span className="font-mono text-xs text-ink-3">{r.companyCode}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="py-2">
          <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-ink-3">Credits</dt>
            <dd className="tabular-nums">{formatCredits(r.credits)}</dd>
            <dt className="text-ink-3">UTR</dt>
            <dd className="font-mono select-all">{r.utr ?? "—"}</dd>
            <dt className="text-ink-3">Paid to</dt>
            <dd className="font-mono break-all">{r.upiId}</dd>
            <dt className="text-ink-3">Requested</dt>
            <dd>
              {formatDateTime(r.requestedAt)}
              {r.requestedBy ? ` · ${r.requestedBy}` : ""}
            </dd>
            <dt className="text-ink-3">Company balance</dt>
            <dd className="tabular-nums">{formatCredits(r.companyBalance)} credits</dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3.5">
        {r.utrAlsoOn.length > 0 ? (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-[13px] leading-relaxed text-warn"
          >
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">This UTR is also on</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {r.utrAlsoOn.map((m) => (
                  <li key={m.id}>
                    <Link to={`/recharges/${m.id}`} className="font-mono underline">
                      {m.code}
                    </Link>{" "}
                    · {m.companyName} · {RECHARGE_STATE_LABELS[m.state]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {r.claimedAt ? (
          <Card>
            <CardContent className="flex flex-col gap-3 py-1">
              <p className="text-sm font-semibold">
                Paid by {r.claimedBy ?? "—"} · {formatDateTime(r.claimedAt)}
              </p>
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
              ) : (
                <p className="text-[13px] text-ink-3">The screenshot couldn&apos;t be loaded.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-1 text-[13px] text-ink-2">
              {r.state === "cancelled"
                ? `Cancelled by the company · ${formatDateTime(r.cancelledAt)}`
                : "The company hasn't paid this yet."}
            </CardContent>
          </Card>
        )}

        {r.state === "waiting" ? (
          <div className="flex flex-wrap gap-2.5">
            <Button type="button" onClick={() => setConfirming(true)}>
              Confirm &amp; add credits
            </Button>
            <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        ) : null}

        {r.confirmedAt ? (
          <Card>
            <CardContent className="py-1 text-[13px] font-medium text-ok">
              Credited by {r.confirmedBy ?? "—"} · {formatDateTime(r.confirmedAt)}
            </CardContent>
          </Card>
        ) : null}

        {r.rejectedAt ? (
          <Card>
            <CardContent className="py-1 text-[13px] leading-relaxed">
              Rejected by {r.rejectedBy ?? "—"}: {r.rejectReason ?? "—"}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Add ${formatCredits(r.credits)} credits to ${r.companyName}?`}
        description={`Only once ${moneyPaise(r.amountPaise)} with UTR ${r.utr ?? "—"} is in your UPI account.`}
        confirmLabel="Confirm & add credits"
        isPending={confirm.isPending}
        onConfirm={() =>
          confirm.mutate(r.id, {
            onSuccess: () => {
              toast.add({ title: `${formatCredits(r.credits)} credits added` });
              trackCreditRechargeConfirmed(r.amountPaise);
              setConfirming(false);
            },
          })
        }
      />
      <RejectRechargeDialog open={rejecting} onOpenChange={setRejecting} recharge={r} />
    </div>
  );
}
