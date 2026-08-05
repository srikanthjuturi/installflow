import { Plus } from "lucide-react";
import { VendorTable } from "@/components/masters/VendorTable";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVendors } from "@/hooks/useMasters";

export default function VendorsPage() {
  const { data, isLoading, isError, error, refetch } = useVendors();

  return (
    <>
      <PageMeta title="Vendors" description="Master & API credentials" />

      <div className="mb-3.5 flex justify-end">
        {/* No vendor-onboarding form is designed yet, so the action is present
            and deliberately inert rather than invented. */}
        <Button className="h-10" disabled>
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
    </>
  );
}
