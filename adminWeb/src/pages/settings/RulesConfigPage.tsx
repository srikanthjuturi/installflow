import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import {
  PenaltyBandTable,
  PenaltyBandTableSkeleton,
} from "@/components/settings/PenaltyBandTable";
import { RuleList, RuleListSkeleton } from "@/components/settings/SlaRuleList";
import {
  ThresholdSlider,
  ThresholdSliderSkeleton,
} from "@/components/settings/ThresholdSlider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useRulesConfig, useSaveRulesConfig } from "@/hooks/useSettings";

export default function RulesConfigPage() {
  const { data: rules, isLoading, isError, error, refetch } = useRulesConfig();
  const save = useSaveRulesConfig();

  // The only editable rule on the screen. `null` means "untouched", so the
  // served value stays the source of truth until someone drags the slider —
  // and "Reset defaults" is just clearing this back to null.
  const [draftThreshold, setDraftThreshold] = useState<number | null>(null);
  const threshold = draftThreshold ?? rules?.ai.threshold ?? 0;
  const isDirty = draftThreshold !== null && draftThreshold !== rules?.ai.threshold;

  function saveConfiguration() {
    save.mutate(
      { aiThreshold: threshold },
      { onSuccess: () => toast.add({ title: "Rules configuration saved" }) },
    );
  }

  return (
    <>
      <PageMeta
        title="Rules configuration"
        description="SLA windows, cancellation penalties, the AI confidence threshold and wait periods."
      />

      {isError ? (
        <ErrorState
          title="Couldn't load the rules configuration"
          error={error}
          onRetry={() => refetch()}
        />
      ) : !isLoading && !rules ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="No rules configured"
          description="SLA windows, penalty bands and the AI threshold will appear here once they are set."
        />
      ) : (
        <>
          {/* Two columns on a desk monitor, stacked on a narrow window.
              Deliberately uncapped: this console is fluid at every width. */}
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            <RuleCard title="SLA windows">
              {rules ? <RuleList rules={rules.sla} /> : <RuleListSkeleton rows={4} />}
            </RuleCard>

            <RuleCard title="Cancellation penalty bands">
              {rules ? (
                <PenaltyBandTable bands={rules.penalty} cap={rules.penaltyCap} />
              ) : (
                <PenaltyBandTableSkeleton rows={4} />
              )}
            </RuleCard>

            <RuleCard title="AI verification threshold">
              {rules ? (
                <ThresholdSlider
                  value={threshold}
                  min={rules.ai.min}
                  max={rules.ai.max}
                  onChange={setDraftThreshold}
                  disabled={save.isPending}
                />
              ) : (
                <ThresholdSliderSkeleton />
              )}
            </RuleCard>

            <RuleCard title="Timing & bandwidth">
              {rules ? <RuleList rules={rules.timing} /> : <RuleListSkeleton rows={3} />}
            </RuleCard>
          </div>

          {save.isError ? (
            <p
              role="alert"
              className="bg-danger-bg text-danger mt-3.5 rounded-md px-4 py-3 text-xs"
            >
              {save.error instanceof Error
                ? save.error.message
                : "Something went wrong. Try again."}
            </p>
          ) : null}

          <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
            <Button
              variant="outline"
              onClick={() => setDraftThreshold(null)}
              disabled={!isDirty || save.isPending}
            >
              Reset defaults
            </Button>
            <Button onClick={saveConfiguration} disabled={isLoading || save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save configuration
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The card chrome the four rule groups share. The page's own `<h1>` comes from
 * the topbar, so each group heading is an `<h2>`.
 */
function RuleCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-3.5 [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle>
          <h2 className="text-sm font-semibold">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
