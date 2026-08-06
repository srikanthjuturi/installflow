import { useState } from "react";
import { Plus } from "lucide-react";
import { PageMeta } from "@/components/shared/PageMeta";
import { TechnicianFormDialog } from "@/components/technicians/TechnicianFormDialog";
import { parsePincodes } from "@/components/technicians/technicianSchema";
import { TechTable } from "@/components/technicians/TechTable";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  useCreateTechnician,
  useTechnicianCategories,
  useTechnicians,
} from "@/hooks/useTechnicians";
import { DEFAULT_PAGE_SIZE, type ListParams } from "@/types/api";

export default function TechnicianListPage() {
  const [isFormOpen, setFormOpen] = useState(false);
  const create = useCreateTechnician();

  // The query the server answers. Search, filters, sort and page all live in
  // one object so the table can hand back a whole new intent in one call.
  const [params, setParams] = useState<ListParams>({
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
    sortBy: "name",
    sortDir: "asc",
  });

  /**
   * Merged into the current query, not swapped for it.
   *
   * "Clear filters" resets the search box and every filter in the same tick.
   * A setter that replaced would let the last of those calls win and quietly
   * put the search term back.
   */
  const applyParams = (next: ListParams) =>
    setParams((prev) => ({
      ...prev,
      ...next,
      filters: { ...prev.filters, ...next.filters },
    }));

  const { data, isLoading, isError, error, refetch } = useTechnicians(params);
  const categories = useTechnicianCategories();

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
              photoUrl: values.photo,
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
                toast.add({
                  title: "Couldn't add technician",
                  description: err.message,
                }),
            }
          )
        }
      />

      <TechTable
        technicians={data?.rows}
        meta={data?.pagination}
        params={params}
        onParams={applyParams}
        categories={categories.data ?? []}
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
