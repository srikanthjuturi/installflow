import { useState } from "react";
import { Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TerritoryFormDialog } from "@/components/masters/TerritoryFormDialog";
import {
  NEW_REGION,
  parsePincodes,
} from "@/components/masters/territorySchema";
import {
  TerritoryTree,
  TerritoryTreeSkeleton,
} from "@/components/masters/TerritoryTree";
import { useCreateMapping, useTerritory } from "@/hooks/useTerritory";

export default function TerritoryPage() {
  const { data, isLoading, isError, error, refetch } = useTerritory();
  const [isFormOpen, setFormOpen] = useState(false);
  const create = useCreateMapping();

  return (
    <>
      <PageMeta
        title="Territory mapping"
        description="Region, Regional Service Head, Area Service Manager and the pincodes each services."
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <p className="text-[13px] text-ink-2">
          Region → Regional Service Head → Area Service Manager → serviced
          pincodes
        </p>
        <Button onClick={() => setFormOpen(true)}>+ Add mapping</Button>
      </div>

      <TerritoryFormDialog
        open={isFormOpen}
        onOpenChange={setFormOpen}
        regions={data ?? []}
        isSubmitting={create.isPending}
        onSubmit={(values) =>
          create.mutate(
            {
              region:
                values.region === NEW_REGION ? values.newRegion : values.region,
              rsh: values.rsh,
              asm: values.asm,
              area: values.area,
              pincodes: parsePincodes(values.pincodes),
            },
            {
              onSuccess: (region) => {
                toast.add({
                  title: `${values.asm} mapped to ${region.region}`,
                  description: `${region.pincount} pincodes now serviced in this region.`,
                });
                setFormOpen(false);
              },
              onError: (err) =>
                toast.add({
                  title: "Couldn't add mapping",
                  description: err.message,
                }),
            }
          )
        }
      />

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
