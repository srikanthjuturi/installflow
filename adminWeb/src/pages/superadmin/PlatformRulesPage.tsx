import { PlatformRulesForm } from "@/components/superadmin/PlatformRulesForm";
import { toInput } from "@/components/superadmin/platformRulesSchema";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { usePlatformSettings, useSavePlatformSettings } from "@/hooks/usePlatform";

/**
 * The platform's rules — what a new company is given, what a ticket costs, how
 * far below zero a company may go, and where recharges are paid.
 *
 * One set for the whole platform, not per company: `platform_settings` is a
 * single row. Errors reach the toaster only (hard rule 9).
 */
export default function PlatformRulesPage() {
  const { data, isLoading, isError, error, refetch } = usePlatformSettings();
  const save = useSavePlatformSettings();

  return (
    <>
      <PageMeta
        title="Rules"
        description="Credits, the ticket charge and where recharges are paid."
      />

      <div className="mb-4">
        <h1 className="text-lg font-semibold text-ink">Rules</h1>
        <p className="text-[13px] text-ink-2">
          What companies are given, what a ticket costs, and where recharges are paid.
        </p>
      </div>

      {isError ? (
        <ErrorState title="Couldn't load the rules" error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <PlatformRulesForm
          // Remounted on every save so the form's defaults are what was stored.
          key={data.updatedAt ?? "unsaved"}
          settings={data}
          isSaving={save.isPending}
          onSubmit={(values) =>
            save.mutate(toInput(values), {
              onSuccess: () => toast.add({ title: "Rules saved" }),
            })
          }
        />
      )}
    </>
  );
}
