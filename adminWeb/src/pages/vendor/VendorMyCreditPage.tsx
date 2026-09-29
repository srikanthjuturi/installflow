import { useState } from "react";
import { ArrowRight, Plus, TrendingUp } from "lucide-react";
import { useSearchParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { AskLimitDialog } from "@/components/vendorCredit/AskLimitDialog";
import { PayDialog } from "@/components/vendorCredit/PayDialog";
import {
  VendorPaymentBadge,
  VendorRequestBadge,
} from "@/components/vendorCredit/VendorCreditBadges";
import { VendorCreditEntriesTable } from "@/components/vendorCredit/VendorCreditEntriesTable";
import { VendorPaymentTable } from "@/components/vendorCredit/VendorPaymentTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrand } from "@/hooks/useBrand";
import { useListParams } from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import {
  useMyCredit,
  useMyCreditEntries,
  useMyLimitRequests,
  useMyVendorPayments,
  useWithdrawLimitRequest,
} from "@/hooks/useVendorCredits";
import { cn } from "@/lib/utils";
import type { VendorCredit } from "@/types/vendorCredit";
import { moneyPaise } from "@/utils/money";

/**
 * What this vendor owes the company it raises tickets for, and how to settle it.
 *
 * ## A credit line, not a wallet
 *
 * A ticket costs nothing when it is raised. It bills when it CLOSES, at the price
 * the product carries, and the line is how much may be outstanding at once. Room
 * left is the limit less what is owed less what open tickets already commit — so
 * raising a ticket reserves its price immediately even though nothing is owed
 * yet. That is what stops the amount running away before anything closes.
 *
 * ## Why this vendor sees its own numbers
 *
 * Elsewhere a portal is shown a boolean where the console gets a figure — a
 * vendor is told intake is paused and never how many credits its company has.
 * This is the deliberate exception: this is a debt with a consequence the vendor
 * feels and a remedy only it can carry out, and "paused" without the number is
 * an instruction to act with no way to know how much.
 */
export default function VendorMyCreditPage() {
  const credit = useMyCredit();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: CreditView =
    searchParams.get("view") === "payments" ? "payments" : "statement";

  return (
    <>
      <PageMeta
        title="Credit"
        description="What you owe, what your open tickets commit, and how to pay"
      />
      <h2 className="sr-only">Credit</h2>

      {credit.isError ? (
        <ErrorState
          title="Couldn't load your credit"
          error={credit.error}
          onRetry={() => credit.refetch()}
        />
      ) : credit.isLoading || !credit.data ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <Summary credit={credit.data} />
          <Requests pendingId={credit.data.pendingRequestId} />
        </>
      )}

      <section aria-label="Statement and payments" className="mt-6">
        <ViewSwitch
          view={view}
          onView={(next) =>
            setSearchParams(next === "payments" ? { view: "payments" } : {})
          }
        />
        {view === "payments" ? (
          <PaymentsList key="payments" />
        ) : (
          <StatementList key="statement" />
        )}
      </section>
    </>
  );
}

type CreditView = "statement" | "payments";

function ViewSwitch({
  view,
  onView,
}: {
  view: CreditView;
  onView: (view: CreditView) => void;
}) {
  const options: { value: CreditView; label: string }[] = [
    { value: "statement", label: "Statement" },
    { value: "payments", label: "Payments" },
  ];
  return (
    <div
      role="group"
      aria-label="What to show"
      className="mb-3.5 flex flex-wrap gap-2"
    >
      {options.map((o) => {
        const active = view === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onView(o.value)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
              active
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-input bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Summary({ credit: c }: { credit: VendorCredit }) {
  const brand = useBrand();
  const [paying, setPaying] = useState(false);
  const [asking, setAsking] = useState(false);
  const origin = useNavOrigin("Back to credit");

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
      <Card className="bg-linear-135 from-(--sidebar-from) to-brand-400 text-white ring-0 dark:to-(--sidebar-to)">
        <CardContent className="flex flex-col">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium opacity-80">Room left</div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                c.paused ? "bg-white text-danger" : "bg-white/20 text-white"
              )}
            >
              {c.paused ? "Tickets paused" : "Active"}
            </span>
          </div>
          <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {moneyPaise(c.availablePaise)}
          </div>
          <div className="mt-1.5 text-xs opacity-70">
            of a {moneyPaise(c.limitPaise)} limit
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col">
          {/* Negative owed means a payment exceeded the debt — an advance, or a
              second payment for the same invoice. It is real and it is theirs, so
              it reads as credit rather than as a negative debt, which is not a
              thing anybody says. */}
          <div className="text-xs font-semibold text-ink-2">
            {c.usedPaise < 0 ? "In credit" : "Owed"}
          </div>
          <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {moneyPaise(Math.abs(c.usedPaise))}
          </div>
          <div className="mt-1.5 text-xs text-ink-3">
            {moneyPaise(c.reservedPaise)} more on tickets that haven&apos;t closed
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex h-full flex-col">
          <div className="text-xs font-semibold text-ink-2">Settle up</div>
          {c.openPaymentId ? (
            <>
              <div className="mt-2.5 flex items-center gap-2">
                <VendorPaymentBadge state="to_pay" />
              </div>
              <div className="mt-1.5 text-xs text-ink-3">
                A payment is already open.
              </div>
              <LinkButton
                to={`/portal/credit/payments/${c.openPaymentId}`}
                state={origin}
                variant="outline"
                size="sm"
                className="mt-3 self-start"
              >
                Continue
                <ArrowRight data-icon="inline-end" />
              </LinkButton>
            </>
          ) : !c.paymentAvailable ? (
            <div className="mt-2.5 text-[13px] leading-relaxed text-ink-2">
              {brand.name} hasn&apos;t set up where to receive payments yet. Ask
              them, or request a higher limit below.
            </div>
          ) : c.maxPaymentPaise <= 0 ? (
            <div className="mt-2.5 text-[13px] leading-relaxed text-ink-2">
              Nothing owed right now. Tickets are billed when they close.
            </div>
          ) : (
            <>
              <div className="mt-1.5 text-xs text-ink-3">
                Pay up to {moneyPaise(c.maxPaymentPaise)} by UPI.
              </div>
              <Button
                type="button"
                size="sm"
                className="mt-3 self-start"
                onClick={() => setPaying(true)}
              >
                <Plus data-icon="inline-start" />
                Pay now
              </Button>
            </>
          )}
          {!c.pendingRequestId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-2 self-start"
              onClick={() => setAsking(true)}
            >
              <TrendingUp data-icon="inline-start" />
              Ask for a higher limit
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <PayDialog open={paying} onOpenChange={setPaying} max={c.maxPaymentPaise} />
      <AskLimitDialog
        open={asking}
        onOpenChange={setAsking}
        currentLimitPaise={c.limitPaise}
      />
    </div>
  );
}

/**
 * The limit requests, when there is one to show.
 *
 * Only the latest, and only while it is pending or was the last thing decided:
 * a vendor needs to know "have I asked, and what came back", not a history of
 * every time it ever asked. The full list is the ops side's problem.
 */
function Requests({ pendingId }: { pendingId: string | null }) {
  const requests = useMyLimitRequests();
  const withdraw = useWithdrawLimitRequest();
  const latest = requests.data?.[0];
  if (!latest) return null;
  // Nothing to say about one the vendor itself withdrew.
  if (latest.status === "cancelled") return null;

  return (
    <Card className="mt-3.5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-1">
        <div className="text-[13px] leading-relaxed">
          <div className="flex items-center gap-2">
            <VendorRequestBadge status={latest.status} />
            <span className="font-medium">
              {moneyPaise(latest.currentLimitPaise)} →{" "}
              {moneyPaise(latest.requestedLimitPaise)}
            </span>
          </div>
          {latest.status === "approved" && latest.grantedLimitPaise !== null ? (
            <p className="mt-1 text-ink-2">
              Granted {moneyPaise(latest.grantedLimitPaise)}.
            </p>
          ) : null}
          {latest.status === "rejected" && latest.rejectReason ? (
            <p className="mt-1 text-ink-2">{latest.rejectReason}</p>
          ) : null}
          {latest.status === "pending" ? (
            <p className="mt-1 text-ink-3">Waiting for a decision.</p>
          ) : null}
        </div>
        {latest.id === pendingId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate(latest.id)}
          >
            Withdraw
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Every movement: one line per ticket billed, one per payment credited. */
function StatementList() {
  const [params, setParams] = useListParams();
  const entries = useMyCreditEntries(params);
  return (
    <VendorCreditEntriesTable
      rows={entries.data?.rows}
      meta={entries.data?.pagination}
      params={params}
      onParams={setParams}
      isLoading={entries.isLoading}
      isFetching={entries.isFetching && !entries.isLoading}
      error={entries.isError ? entries.error : null}
      onRetry={() => entries.refetch()}
    />
  );
}

function PaymentsList() {
  const [params, setParams] = useListParams();
  const payments = useMyVendorPayments(params);
  return (
    <VendorPaymentTable
      rows={payments.data?.rows}
      meta={payments.data?.pagination}
      params={params}
      onParams={setParams}
      isLoading={payments.isLoading}
      isFetching={payments.isFetching && !payments.isLoading}
      error={payments.isError ? payments.error : null}
      onRetry={() => payments.refetch()}
      to={(r) => `/portal/credit/payments/${r.id}`}
      backLabel="Back to credit"
    />
  );
}
