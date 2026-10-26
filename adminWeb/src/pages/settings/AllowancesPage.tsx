import { Building2 } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { AllowancesView } from "@/components/allowances/AllowancesView";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureAccess, useMe } from "@/hooks/useAuth";
import { useFranchiseeOptions } from "@/hooks/useFranchisees";

/**
 * Configuration → Allowances — the HOME franchisee's travel and speed rules
 * (Task 13 §5.4, F8). A non-home franchisee's are its own franchise admins' to
 * edit; staff read them on that franchisee's page.
 *
 * Editing is Admin and National Head with `settings.edit` — the same pair the
 * API's National-Head floor allows. Anyone else who can open the page (a
 * Regional Head with `settings.view`) sees every box disabled and no Save.
 * Presentation only — the server refuses the write regardless (hard rule 8).
 *
 * The home franchisee's id is only needed to build the speed URL; travel's
 * door implies it. It comes from the same cached options list the Franchisees
 * screen shares.
 */
export default function AllowancesPage() {
  const { has } = useFeatureAccess();
  const { data: me } = useMe();
  const options = useFranchiseeOptions({ enabled: has("franchisees.view") });
  const home = options.data?.find((o) => o.isHome);

  const readOnly = !(
    has("settings.edit") && (me?.role === "admin" || me?.role === "national_head")
  );

  return (
    <>
      <PageMeta
        title="Allowances"
        description="Travel and speed allowances for the home franchisee's technicians"
      />
      {options.isError ? (
        <ErrorState
          title="Couldn't load the franchisee"
          error={options.error}
          onRetry={() => options.refetch()}
        />
      ) : options.isLoading ? (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : !home ? (
        <EmptyState
          icon={Building2}
          title="No home franchisee found"
          description="Allowances belong to a franchisee, and this company's home one could not be read."
        />
      ) : (
        <AllowancesView
          scope={{ kind: "home", franchiseeId: home.id }}
          readOnly={readOnly}
          franchiseeName={home.name}
        />
      )}
    </>
  );
}
