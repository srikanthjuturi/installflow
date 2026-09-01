import { useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { BonusPicker } from "@/components/escalations/BonusPicker";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useAddBonus } from "@/hooks/useEscalations";
import { originFor, readNavOrigin } from "@/hooks/useNavOrigin";
import { useLedgerPool } from "@/hooks/useLedger";
import { useRulesConfig } from "@/hooks/useSettings";
import { useCandidateTechnicians } from "@/hooks/useTechnicians";
import { useTicket } from "@/hooks/useTickets";
import { formatSlot, slotCountdown } from "@/utils/datetime";
import { money, moneyPaise } from "@/utils/money";

/**
 * Which chip the picker opens on — a POSITION, not an amount.
 *
 * The approved design opens on the second band. Holding the position rather
 * than ₹400 means editing the bands in Rules configuration can never leave
 * this page opening on an amount that no longer exists.
 */
const DEFAULT_BAND = 1;

/**
 * Fund a re-notification on an escalated ticket.
 *
 * Ticket-scoped, like its sibling at `/tickets/:id/assign`. It used to live at
 * `/escalations/:id/bonus` over a mock keyed by ticket CODE, so a real ticket's
 * UUID could only ever come back as "Escalation <uuid> not found"; both screens
 * now read the same `useTicket(id)` as everything else, which is also what
 * stops the queue and the ticket disagreeing about a status mid-decision.
 */
export default function BonusSetupPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /* The queue is the only way in today, which is exactly why the destination
     was written into this screen as a constant — and why its sibling at
     `/tickets/:id/assign` was wrong the moment the queue started linking to it
     too. Read the origin like everything else and keep the queue as the
     fallback: same behaviour on a pasted link, no second screen to fix later. */
  const origin = readNavOrigin(location.state);
  const backHref = origin?.backTo ?? "/escalations";
  const backText = origin?.backLabel ?? "Back to escalations";

  const {
    data: ticket,
    isLoading,
    isError,
    error,
    refetch,
    dataUpdatedAt,
  } = useTicket(id);
  // Measured against when the ticket was READ. `new Date()` during render is
  // impure, and it would also drift from the row it is describing.
  const countdown = slotCountdown(
    ticket?.slotStart,
    ticket?.slotEnd,
    new Date(dataUpdatedAt)
  );
  // Eligibility is a question about THIS ticket — its subcategory, its pincode
  // — so the count waits for the ticket rather than asking early and reporting
  // a number that is not the shortlist. `onDay` is the SLOT's day: a bonus is
  // only offered to technicians with room on the day the work happens.
  const eligible = useCandidateTechnicians(
    ticket?.subcategoryId,
    ticket?.pincode,
    ticket?.slotStart
  );
  // The chips are configuration, not a constant in the picker — this screen
  // needs them as much as it needs the ticket, because without them there is
  // nothing to choose from.
  const {
    data: rules,
    isError: rulesFailed,
    error: rulesError,
    refetch: refetchRules,
  } = useRulesConfig();
  const bands = rules?.bonusAmounts;
  // What is left in the pool a bonus is drawn against. Shown, not enforced:
  // the API does not refuse a bonus that overdraws it, because a manager
  // choosing to commit more than the cancellations have funded is a decision
  // and not a mistake — and the balance can be read back either way.
  const pool = useLedgerPool();
  const addBonus = useAddBonus();

  // Null until a manager actually picks, so the opening band follows the
  // served config instead of being frozen at first render.
  const [chosen, setChosen] = useState<number | null>(null);
  const amount = chosen ?? bands?.[DEFAULT_BAND] ?? 0;

  // Is this bonus bigger than the pool holds?
  //
  // Deliberately NOT phrased as "this takes the pool to −₹2,100". Funding a
  // bonus moves no money — it is paid out only when somebody finishes the job
  // — so a figure claiming the balance had already changed would be false at
  // the moment it was read.
  //
  // It also does not try to count every other bonus funded and not yet paid.
  // That is a real number and a bigger query, and the question this line
  // answers is the one a manager is actually asking as they press the button:
  // am I committing more than we have collected?
  const balance = pool.data?.balancePaise;
  const overdrawn = balance !== undefined && amount * 100 > balance;

  // Somebody took it while this page was open, or a colleague assigned it.
  // There is nothing left to incentivise, and the ticket says why.
  //
  // Silent once WE are the ones who moved it. Funding a bonus puts the ticket
  // back to `New`, so the invalidated read satisfies this test a beat before
  // `onSuccess` navigates — and the manager who pressed the button landed on
  // the ticket instead of back at the queue, as though something had gone
  // wrong. The guard is for a change somebody ELSE made.
  const weMovedIt = addBonus.isPending || addBonus.isSuccess;
  if (
    ticket &&
    !weMovedIt &&
    (ticket.status !== "Escalated" || ticket.technicianId)
  ) {
    const ticketPath = `/tickets/${ticket.id}`;
    return (
      <Navigate to={ticketPath} replace state={originFor(ticketPath, origin)} />
    );
  }

  function confirm() {
    if (!ticket) return;
    addBonus.mutate(
      { id: ticket.id, amountPaise: amount * 100 },
      {
        onSuccess: (result) => {
          toast.add({
            title: `Re-notified ${result.notified} technician${
              result.notified === 1 ? "" : "s"
            } with ${money(amount)} bonus`,
            description: `The confirmed slot (${formatSlot(
              ticket.slotStart,
              ticket.slotEnd
            )}) stays locked.`,
          });
          navigate(backHref, { state: origin?.backState });
        },
      }
    );
  }

  return (
    <>
      <PageMeta
        title="Bonus setup"
        description="Fund a re-notification incentive on an escalated ticket."
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

      {isError || rulesFailed ? (
        <ErrorState
          title={
            isError
              ? "Couldn't load this ticket"
              : "Couldn't load the bonus bands"
          }
          error={isError ? error : rulesError}
          onRetry={() => (isError ? refetch() : refetchRules())}
        />
      ) : isLoading || !ticket || !bands ? (
        <BonusSetupSkeleton />
      ) : (
        <Card className="max-w-190 gap-0 py-0">
          <CardHeader className="border-b border-line-2 p-4.5">
            <CardTitle>
              <h2>Bonus on re-notification · {ticket.code}</h2>
            </CardTitle>
            <p className="text-xs text-ink-3">
              Incentivize a fast pickup. The bonus is paid to whoever accepts.
            </p>
          </CardHeader>

          <CardContent className="p-5.5">
            <div className="mb-5 flex flex-wrap gap-3.5">
              {/* Back, and real. This tile showed an invented figure until the
                  cancel flow landed, because §7's pool is funded by collected
                  cancellation penalties and nothing collected one. It is now
                  `penalties collected − bonuses paid` over this company's
                  ledger. */}
              <Stat
                label="Available pool"
                value={
                  pool.isLoading ? null : moneyPaise(pool.data?.balancePaise)
                }
                tone={(pool.data?.balancePaise ?? 0) > 0 ? "ok" : "danger"}
              />
              <Stat
                label="Eligible technicians"
                value={
                  eligible.isLoading ? null : String(eligible.data?.length ?? 0)
                }
              />
              {/* Label and figure come from one call, so this tile cannot say
                  "Time to slot" over a window that has already opened — see
                  `slotCountdown`. The queue's cards read the same way. */}
              <Stat
                label={countdown.label}
                value={countdown.value}
                tone={countdown.state === "closed" ? undefined : "danger"}
              />
            </div>

            {/* Already funded once — the amount below REPLACES it rather than
                adding to it, so a manager who came back to raise a bonus needs
                to see what is already on the job. */}
            {ticket.bonusPaise !== null ? (
              <p className="mb-4 text-xs text-ink-3">
                This job already has a{" "}
                <b className="font-semibold text-ink">
                  {moneyPaise(ticket.bonusPaise)}
                </b>{" "}
                bonus. Selecting an amount below replaces it.
              </p>
            ) : null}

            <BonusPicker
              amounts={bands}
              value={amount}
              onChange={setChosen}
              disabled={addBonus.isPending}
            />

            {/* The failure is reported in the toaster (App.tsx), not here. */}
            <p className="mt-5 flex items-start gap-2.5 rounded-md border border-info/20 bg-info-bg px-4 py-3.5 text-xs leading-relaxed text-info">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                The confirmed slot (
                {formatSlot(ticket.slotStart, ticket.slotEnd)}) stays locked.
                Re-notification goes to all eligible technicians instantly;
                product &amp; customer details release only on acceptance.
              </span>
            </p>
          </CardContent>

          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line-2 p-4">
            {/* Warned, never blocked. Spending past the pool to keep three
                customer promises on a Friday evening is obviously the right
                call, and refusing it would veto the one action that saves the
                appointment — so this says what it costs and gets out of the
                way. The balance is a running total, not a budget. */}
            {overdrawn ? (
              <p className="mr-auto text-xs text-warn">
                This is more than the pool holds ({moneyPaise(balance)}). The
                balance will go negative once it is paid.
              </p>
            ) : null}
            {/* Cancel goes where Back goes: they are the same retreat, and a
                pair that disagreed would make one of them a surprise. */}
            <LinkButton
              variant="outline"
              size="lg"
              to={backHref}
              state={origin?.backState}
            >
              Cancel
            </LinkButton>
            <Button size="lg" disabled={addBonus.isPending} onClick={confirm}>
              {addBonus.isPending ? <Spinner data-icon="inline-start" /> : null}
              Add {money(amount)} bonus &amp; re-notify
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

/** One of the three figures above the picker. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: "ok" | "danger";
}) {
  return (
    <div className="min-w-40 flex-1 rounded-md border border-line-2 bg-surface-2 px-3.75 py-3.25">
      <div className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
        {label}
      </div>
      {value === null ? (
        <Skeleton className="mt-1 h-6 w-20" />
      ) : (
        <div
          className={
            tone === "ok"
              ? "mt-1 text-xl font-semibold text-ok"
              : tone === "danger"
                ? "mt-1 text-xl font-semibold text-danger"
                : "mt-1 text-xl font-semibold"
          }
        >
          {value}
        </div>
      )}
    </div>
  );
}

/** The card's real shape, so nothing jumps when the ticket lands. */
function BonusSetupSkeleton() {
  return (
    <Card className="max-w-190 gap-0 py-0">
      <CardHeader className="border-b border-line-2 p-4.5">
        <Skeleton className="h-5 w-72" />
        <Skeleton className="mt-1 h-3.5 w-full max-w-140" />
      </CardHeader>
      <CardContent className="p-5.5">
        <div className="mb-5 flex flex-wrap gap-3.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="min-w-40 flex-1 rounded-md border border-line-2 bg-surface-2 px-3.75 py-3.25"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-6 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-3.5 w-24" />
        <div className="mt-1.5 flex flex-wrap gap-2.5">
          {/* Four chips — the four approved bands. */}
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-25 rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-5 h-16 rounded-md" />
      </CardContent>
      <div className="flex justify-end gap-2.5 border-t border-line-2 p-4">
        <Skeleton className="h-9 w-20 rounded-lg" />
        <Skeleton className="h-9 w-55 rounded-lg" />
      </div>
    </Card>
  );
}
