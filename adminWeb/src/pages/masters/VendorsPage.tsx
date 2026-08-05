import { useState } from "react";
import { Plus } from "lucide-react";
import { VendorFormDialog } from "@/components/masters/VendorFormDialog";
import { VendorTable } from "@/components/masters/VendorTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/useListParams";
import { useVendors } from "@/hooks/useMasters";

export default function VendorsPage() {
  // The page owns the query string; the table reports intent into it.
  const [params, setParams] = useListParams();
  const { data, isLoading, isError, error, refetch } = useVendors(params);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageMeta title="Vendors" description="Master & API credentials" />

      <h2 className="sr-only">Vendors</h2>
      <VendorTable
        vendors={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={setParams}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        toolbarActions={
          <Button
            type="button"
            className="h-10"
            onClick={() => setAdding(true)}
          >
            <Plus data-icon="inline-start" />
            Add vendor
          </Button>
        }
      />

      {/* Onboarding — no vendor prop. The per-row Manage dialog lives with the
          table, since the row is what supplies the record. */}
      <VendorFormDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
