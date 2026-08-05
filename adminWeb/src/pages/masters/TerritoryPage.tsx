import { Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TerritoryTree, TerritoryTreeSkeleton } from "@/components/masters/TerritoryTree";
import { useTerritory } from "@/hooks/useTerritory";

export default function TerritoryPage() {
  const { data, isLoading, isError, error, refetch } = useTerritory();

  return (
    <>
      <PageMeta
        title="Territory mapping"
        description="Region, Regional Service Head, Area Service Manager and the pincodes each services."
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <p className="text-ink-2 text-[13px]">
          Region → Regional Service Head → Area Service Manager → serviced pincodes
        </p>
        {/* No mapping form is designed yet, so this stays inert rather than
            inventing one. */}
        <Button disabled>+ Add mapping</Button>
      </div>

      {isError ? (
        <ErrorState
          title="Couldn't load territory mapping"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <TerritoryTreeSkeleton />
      ) : !data || data.length === 0 ? (
        // Not a benign empty: an unmapped pincode has no ASM, so no technician
        // is eligible and nothing gets notified.
        <EmptyState
          icon={Map}
          title="No territory mapped"
          description="Map a region to a Regional Service Head and an Area Service Manager before tickets in its pincodes can be notified."
        />
      ) : (
        <TerritoryTree regions={data} />
      )}
    </>
  );
}
