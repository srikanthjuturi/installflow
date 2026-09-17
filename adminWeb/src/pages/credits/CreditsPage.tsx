import { useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowRight, Plus } from "lucide-react";
import { RechargeBadge } from "@/components/credits/RechargeBadge";
import { RechargeDialog } from "@/components/credits/RechargeDialog";
import { CreditEntriesTable } from "@/components/credits/CreditEntriesTable";
import { RechargeTable } from "@/components/credits/RechargeTable";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreditEntries, useCredits, useRecharges } from "@/hooks/useCredits";
import { useListParams } from "@/hooks/useListParams";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { cn } from "@/lib/utils";
import type { CreditSummary } from "@/types/credits";
import { formatCredits } from "@/utils/credits";
import { moneyPaise } from "@/utils/money";

/**
 * A company's credits — what it has left to raise tickets with, and topping up.
 *
 * Admin and National Head only (`credits.manage` plus a rank floor the server
 * holds): the people who can recharge. The balance is summed live on the
 * server, never kept here, and credits arrive only when the superadmin confirms
 * a payment — there is nothing on this page that adds them.
 *
 * ## Two lists, one on screen at a time
 *
 * **Credit history** is every change to the balance — free credits, one line
 * per ticket raised, and each recharge once it was credited — so it adds up to
 * the figure above. **Payments** is every UPI request the company made,
 * including the ones that never added a credit (still to pay, waiting,
 * rejected, cancelled).
 *
 * They used to be stacked, and a credited recharge then showed twice on one
 * screen under two names. They are not merged either: ticket lines outnumber
 * payments by hundreds to one, so a single table would bury the only rows
 * anybody opens. The history leads; a payment still to finish is already in
 * the Recharge card, so Payments is the occasional look.
 *
 * The list on screen is `?view=` in the URL, as Approvals does it.
 */
export default function CreditsPage() {
  const summary = useCredits();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: CreditsView =
    searchParams.get("view") === "payments" ? "payments" : "history";

  return (
    <>
      <PageMeta
        title="Credits"
        description="Your credit balance, credit history and payments"
      />
      <h2 className="sr-only">Credits</h2>

      {summary.isError ? (
        <ErrorState
          title="Couldn't load your credits"
          error={summary.error}
          onRetry={() => summary.refetch()}
        />
      ) : summary.isLoading || !summary.data ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <Summary summary={summary.data} />
      )}

      <section aria-label="Credit history and payments" className="mt-6">
        <ViewSwitch
          view={view}
          // Replaces the whole query string, as Approvals does: each list keeps
          // its own filters, and carrying one's `?state=` into the other would
          // open it narrowed for a reason nobody chose.
          onView={(next) =>
            setSearchParams(next === "payments" ? { view: "payments" } : {})
          }
        />
        {/* Keyed, so switching starts the other list from its own defaults
            rather than inheriting a page number from this one. */}
        {view === "payments" ? (
          <PaymentsList key="payments" />
        ) : (
          <HistoryList key="history" />
        )}
      </section>
    </>
  );
}

type CreditsView = "history" | "payments";

/**
 * Two buttons, not tabs — the same control, and the same look, as the
 * Products / Brands switch on Approvals: one list at a time, chosen in the URL.
 */
function ViewSwitch({
  view,
  onView,
}: {
  view: CreditsView;
  onView: (view: CreditsView) => void;
}) {
  const options: { value: CreditsView; label: string }[] = [
    { value: "history", label: "Credit history" },
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

/** Every change to the balance, newest first. */
function HistoryList() {
  const [params, setParams] = useListParams();
  const entries = useCreditEntries(params);
  return (
    <CreditEntriesTable
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

/**
 * Every UPI request, newest first. A full page of them now — the five-row
 * limit was for sitting above the statement, which it no longer does.
 */
function PaymentsList() {
  const [params, setParams] = useListParams();
  const recharges = useRecharges(params);
  return (
    <RechargeTable
      rows={recharges.data?.rows}
      meta={recharges.data?.pagination}
      params={params}
      onParams={setParams}
      isLoading={recharges.isLoading}
      isFetching={recharges.isFetching && !recharges.isLoading}
      error={recharges.isError ? recharges.error : null}
      onRetry={() => recharges.refetch()}
    />
  );
}

function Summary({ summary: s }: { summary: CreditSummary }) {
  const [recharging, setRecharging] = useState(false);
  const origin = useNavOrigin("Back to credits");
  const open = s.openRecharge;
  const standing = s.paused
    ? "Tickets paused"
    : s.balance < 0
      ? "Using minus credits"
      : "Active";

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
      <Card className="bg-linear-135 from-(--sidebar-from) to-brand-400 text-white ring-0 dark:to-(--sidebar-to)">
        <CardContent className="flex flex-col">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium opacity-80">Balance</div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                s.paused ? "bg-white text-danger" : "bg-white/20 text-white"
              )}
            >
              {standing}
            </span>
          </div>
          <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {formatCredits(s.balance)}
          </div>
          <div className="mt-1.5 text-xs opacity-70">credits</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col">
          <div className="text-xs font-semibold text-ink-2">Per ticket</div>
          <div className="mt-2.5 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
            {formatCredits(s.ticketCredits)}
          </div>
          <div className="mt-1.5 text-xs text-ink-3">
            credits per ticket · can go down to −
            {formatCredits(s.minusCreditLimit)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex h-full flex-col">
          <div className="text-xs font-semibold text-ink-2">Recharge</div>
          {open ? (
            <>
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-lg leading-none font-semibold tabular-nums">
                  {moneyPaise(open.amountPaise)}
                </span>
                <RechargeBadge state={open.state} />
              </div>
              <div className="mt-1.5 font-mono text-xs text-ink-3">
                {open.code}
              </div>
              <LinkButton
                to={`/credits/recharges/${open.id}`}
                state={origin}
                variant="outline"
                size="sm"
                className="mt-3 self-start"
              >
                Continue
                <ArrowRight data-icon="inline-end" />
              </LinkButton>
            </>
          ) : s.rechargeAvailable ? (
            <>
              <div className="mt-1.5 text-xs text-ink-3">
                One credit for every rupee, paid by UPI.
              </div>
              <Button
                type="button"
                size="sm"
                className="mt-3 self-start"
                onClick={() => setRecharging(true)}
              >
                <Plus data-icon="inline-start" />
                Recharge
              </Button>
            </>
          ) : (
            <div className="mt-2.5 text-[13px] text-ink-2">
              Recharges aren&apos;t available yet.
            </div>
          )}
        </CardContent>
      </Card>

      <RechargeDialog
        open={recharging}
        onOpenChange={setRecharging}
        min={s.minRechargeRupees}
        max={s.maxRechargeRupees}
      />
    </div>
  );
}
