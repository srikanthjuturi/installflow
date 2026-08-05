import { useState } from "react";
import { Plus } from "lucide-react";
import { VendorFormDialog } from "@/components/masters/VendorFormDialog";
import { VendorTable } from "@/components/masters/VendorTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVendors } from "@/hooks/useMasters";

export default function VendorsPage() {
  const { data, isLoading, isError, error, refetch } = useVendors();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageMeta title="Vendors" description="Master & API credentials" />

      <div className="mb-3.5 flex justify-end">
        <Button type="button" className="h-10" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          Add vendor
        </Button>
      </div>

      <Card>
        <CardContent className="px-0 pb-0">
          <h2 className="sr-only">Vendors</h2>
          <VendorTable
            vendors={data}
            isLoading={isLoading}
            error={isError ? error : null}
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>

      {/* Onboarding — no vendor prop. The per-row Manage dialog lives with the
          table, since the row is what supplies the record. */}
      <VendorFormDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
