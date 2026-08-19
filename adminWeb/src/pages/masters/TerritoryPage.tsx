import { Map } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import {
  TerritoryTree,
  TerritoryTreeSkeleton,
} from "@/components/masters/TerritoryTree";
import { LinkButton } from "@/components/shared/LinkButton";
import { useTerritory } from "@/hooks/useTerritory";

/**
 * Read-only. The mapping is made by giving a user a region (Regional Head) or a
 * region plus pincodes (Area Manager) on Users & roles — so this page shows the
 * result rather than offering a second, competing way to record it.
 */
export default function TerritoryPage() {
  const { data, isLoading, isError, error, refetch } = useTerritory();

  return (
    <>
      <PageMeta
        title="Territory mapping"
        description="Region, Regional Head, Area Manager and the pincodes each services."
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <p className="text-[13px] text-ink-2">
          Region → Regional Head → Area Manager → serviced pincodes
        </p>
        {/* `outline` is built for a CARD or a dialog: its fill is
            `bg-background`, which on a page is the page's own colour, and its
            border sits at 1.11:1 against it — a control with no visible
            boundary. White plus a brand border takes that to 7.72:1 and reads
            as the secondary action it is, without promoting a navigation link
            to a primary button. */}
        <LinkButton
          to="/settings/users"
          variant="outline"
          className="border-brand-400 bg-surface text-brand-500 hover:bg-brand-100"
        >
          Assign in Users &amp; roles
        </LinkButton>
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
        // Not a benign empty: an unmapped pincode has no area manager, so no
        // technician is eligible and nothing gets notified.
        <EmptyState
          icon={Map}
          title="No territory mapped"
          description="Give a Regional Head their regions and an Area Manager their pincodes before tickets in those pincodes can be notified."
        />
      ) : (
        <TerritoryTree regions={data} />
      )}
    </>
  );
}
