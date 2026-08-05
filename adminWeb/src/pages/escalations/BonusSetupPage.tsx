import { useState } from "react";
import { ArrowLeft, Info, SearchX } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { BonusPicker } from "@/components/escalations/BonusPicker";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useAddBonus, useEscalation } from "@/hooks/useEscalations";
import { useEligibleTechnicians } from "@/hooks/useTechnicians";
import { money } from "@/utils/money";

/** The prototype opens on the middle band. */
const DEFAULT_BONUS = 400;

export default function BonusSetupPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const {
    data: escalation,
    isLoading,
    isError,
    error,
    refetch,
  } = useEscalation(id);
  const eligible = useEligibleTechnicians();
  const addBonus = useAddBonus();

  const [amount, setAmount] = useState<number>(DEFAULT_BONUS);

  function confirm() {
    addBonus.mutate(
      { id, amount },
      {
        onSuccess: (result) => {
          toast.add({
            title: `Re-notified ${result.notified} technicians with ${money(result.amount)} bonus`,
            description: escalation
              ? `The confirmed slot (${escalation.slot}) stays locked.`
              : undefined,
          });
          navigate("/escalations");
        },
      }
    );
  }

  return (
    <>
      <PageMeta
        title="Bonus setup"
        description="Fund a re-notification incentive from the penalty pool."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to="/escalations"
      >
        <ArrowLeft data-icon="inline-start" />
        Back to escalations
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this escalation"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <BonusSetupSkeleton />
      ) : !escalation ? (
        <EmptyState
          icon={SearchX}
          title="This ticket is no longer escalated"
          description="Someone has already picked it up, or it was assigned manually."
          action={
            <LinkButton to="/escalations">Back to escalations</LinkButton>
          }
        />
      ) : (
        <Card className="max-w-190 gap-0 py-0">
          <CardHeader className="border-b border-line-2 p-4.5">
            <CardTitle>
              <h2>Bonus on re-notification · {escalation.id}</h2>
            </CardTitle>
            <p className="text-xs text-ink-3">
              Incentivize a fast pickup. The bonus is funded from the penalty
              pool and paid to whoever accepts.
            </p>
          </CardHeader>

          <CardContent className="p-5.5">
            <div className="mb-5 flex flex-wrap gap-3.5">
              <Stat
                label="Available pool"
                value={money(escalation.pool)}
                tone="ok"
              />
              <Stat
                label="Eligible technicians"
                value={
                  eligible.isLoading ? null : String(eligible.data?.length ?? 0)
                }
              />
              <Stat
                label="Time to slot"
                value={escalation.left}
                tone="danger"
              />
            </div>

            <BonusPicker
              value={amount}
              onChange={setAmount}
              disabled={addBonus.isPending}
              max={escalation.pool}
            />

            {addBonus.isError ? (
              <p
                role="alert"
                className="mt-5 rounded-md bg-danger-bg px-4 py-3 text-xs text-danger"
              >
                {addBonus.error instanceof Error
                  ? addBonus.error.message
                  : "Something went wrong. Try again."}
              </p>
            ) : null}

            <p className="mt-5 flex items-start gap-2.5 rounded-md border border-info/20 bg-info-bg px-4 py-3.5 text-xs leading-relaxed text-info">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                The confirmed slot ({escalation.slot}) stays locked.
                Re-notification goes to all eligible technicians instantly;
                product &amp; customer details release only on acceptance.
              </span>
            </p>
          </CardContent>

          <div className="flex flex-wrap justify-end gap-2.5 border-t border-line-2 p-4">
            <LinkButton variant="outline" size="lg" to="/escalations">
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

/** The card's real shape, so nothing jumps when the escalation lands. */
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
