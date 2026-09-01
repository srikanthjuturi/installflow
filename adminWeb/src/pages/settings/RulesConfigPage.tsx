import { SlidersHorizontal } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { RulesForm } from "@/components/settings/RulesForm";
import { toDraft } from "@/components/settings/rulesSchema";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useRulesConfig, useSaveRulesConfig } from "@/hooks/useSettings";

export default function RulesConfigPage() {
  const { data: rules, isLoading, isError, error, refetch } = useRulesConfig();
  const save = useSaveRulesConfig();

  return (
    <>
      <PageMeta
        title="Rules configuration"
        description="Cancellation penalties, the AI confidence threshold, and the timing rules that drive escalation and closure."
      />

      {isError ? (
        <ErrorState
          title="Couldn't load the rules configuration"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      ) : !rules ? (
        // Barely reachable: the API creates this company's row on first read
        // if the migration's backfill somehow missed it, so a 200 always
        // carries rules. Kept for the case where it answers otherwise.
        <EmptyState
          icon={SlidersHorizontal}
          title="No rules configured"
          description="Penalty bands, bonus bands, the AI threshold and the timing rules will appear here once they are set."
        />
      ) : (
        <>
          {save.isError ? (
            <p
              role="alert"
              className="mb-3.5 rounded-md bg-danger-bg px-4 py-3 text-xs text-danger"
            >
              {save.error instanceof Error
                ? save.error.message
                : "Something went wrong. Try again."}
            </p>
          ) : null}

          {/* Keyed on the served values so a successful save re-seeds the
              form's defaults — otherwise Reset would revert to whatever loaded
              on first mount, not to what is now saved. */}
          <RulesForm
            key={JSON.stringify(rules)}
            rules={rules}
            isSaving={save.isPending}
            onSubmit={(values) =>
              save.mutate(toDraft(values), {
                onSuccess: () =>
                  toast.add({
                    title: "Rules configuration saved",
                    // It said "Applied for this session" while Save wrote to a
                    // JavaScript object that died with the tab. It writes to
                    // `company_rules` now, and the sweeps read it on their next
                    // tick — so the copy says what actually happens.
                    description:
                      "In effect for this company from the next sweep.",
                  }),
              })
            }
          />
        </>
      )}
    </>
  );
}
