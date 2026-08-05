import { useState } from "react";
import { Plus } from "lucide-react";
import {
  CategoryCard,
  CategoryCardSkeleton,
} from "@/components/masters/CategoryCard";
import { CategoryFormDialog } from "@/components/masters/CategoryFormDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/useMasters";

export default function CategoriesPage() {
  const { data, isLoading, isError, error, refetch } = useCategories();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageMeta title="Categories & models" description="Product master" />

      <div className="mb-3.5 flex justify-end">
        <Button type="button" className="h-10" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          Add category
        </Button>
      </div>

      {isError ? (
        <ErrorState
          title="Couldn't load categories"
          error={error}
          onRetry={() => refetch()}
        />
      ) : !isLoading && !data?.length ? (
        <EmptyState
          title="No categories yet"
          description="Product categories appear here with their models and certified technicians."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <CategoryCardSkeleton key={i} />
              ))
            : data?.map((c) => <CategoryCard key={c.name} category={c} />)}
        </div>
      )}

      <CategoryFormDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
