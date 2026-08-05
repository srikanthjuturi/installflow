import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { TechnicianFormDialog } from "@/components/technicians/TechnicianFormDialog";
import { parsePincodes } from "@/components/technicians/technicianSchema";
import { TechTable } from "@/components/technicians/TechTable";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useCreateTechnician, useTechnicians } from "@/hooks/useTechnicians";

export default function TechnicianListPage() {
  const [isFormOpen, setFormOpen] = useState(false);
  const create = useCreateTechnician();

  // One unfiltered fetch: DataTable owns search, filtering, sorting and paging
  // from here, so the page no longer re-queries per category.
  const { data, isLoading, isError, error, refetch } = useTechnicians();

  const categories = useMemo(
    () => [...new Set((data ?? []).flatMap((t) => t.cats))].sort(),
    [data],
  );

  return (
    <>
      <PageMeta
        title="Technicians"
        description="Technician master list — categories, pincodes, bandwidth and cancellations."
      />

      <TechnicianFormDialog
        open={isFormOpen}
        onOpenChange={setFormOpen}
        isSubmitting={create.isPending}
        onSubmit={(values) =>
          create.mutate(
            {
              name: values.name,
              phone: values.phone,
              cats: values.cats,
              pincodes: parsePincodes(values.pincodes),
              bwTotal: Number(values.bwTotal),
            },
            {
              onSuccess: (technician) => {
                toast.add({
                  title: `${technician.name} added`,
                  description: `${technician.id} · ${technician.bwTotal} jobs/day.`,
                });
                setFormOpen(false);
              },
              onError: (err) =>
                toast.add({ title: "Couldn't add technician", description: err.message }),
            },
          )
        }
      />

      <TechTable
        technicians={data}
        categories={categories}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => refetch()}
        toolbarActions={
          <Button className="h-10" onClick={() => setFormOpen(true)}>
            <Plus data-icon="inline-start" />
            Add technician
          </Button>
        }
      />
    </>
  );
}
