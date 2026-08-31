import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";
import { CategoryFormDialog } from "@/components/masters/CategoryFormDialog";
import {
  CategoryTree,
  CategoryTreeSkeleton,
  type MasterAction,
} from "@/components/masters/CategoryTree";
import { masterNodeId } from "@/components/masters/nodeIds";
import { ConfirmDeleteDialog } from "@/components/masters/ConfirmDeleteDialog";
import { ModelFormDialog } from "@/components/masters/ModelFormDialog";
import { SubcategoryFormDialog } from "@/components/masters/SubcategoryFormDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import {
  useCategoryTree,
  useDeleteCategory,
  useDeleteModel,
  useDeleteSubcategory,
} from "@/hooks/useProductMaster";

/** The one dialog that is open, if any. `null` is "none". */
type OpenDialog = MasterAction | { kind: "add-category" } | null;

export default function CategoriesPage() {
  // Inactive rows are shown here and nowhere else: this is the screen where a
  // paused category is un-paused, so hiding it would strand it.
  const { data, isLoading, isError, error, refetch } = useCategoryTree(true);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const { has } = useFeatureAccess();
  const canEdit = has("masters.edit");

  const deleteCategory = useDeleteCategory();
  const deleteSubcategory = useDeleteSubcategory();
  const deleteModel = useDeleteModel();

  /**
   * `?focus=<id>` — where a global-search hit on the product master lands.
   *
   * Nothing in the master has a detail route; it is one page with the whole
   * tree already expanded on it. So a hit points at a node, and the page's job
   * is to put that node in front of you rather than leave you scanning a
   * hundred chips for the one you asked for.
   *
   * Written straight to the DOM rather than held in state: this is a one-off
   * visual cue with no meaning afterwards, and a re-render that dropped it
   * would be a highlight that flickered off mid-look. Runs once the tree has
   * data — the node does not exist before that.
   */
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const loaded = !!data?.length;

  useEffect(() => {
    if (!focusId || !loaded) return;
    const node = document.getElementById(masterNodeId(focusId));
    if (!node) return;

    node.scrollIntoView({ block: "center", behavior: "smooth" });
    const ring = ["ring-2", "ring-brand-500", "rounded-md"];
    node.classList.add(...ring);
    const timer = window.setTimeout(() => node.classList.remove(...ring), 2400);
    return () => {
      window.clearTimeout(timer);
      node.classList.remove(...ring);
    };
  }, [focusId, loaded]);

  const close = () => setDialog(null);
  const removed = (name: string) => () => {
    toast.add({ title: `${name} removed` });
    close();
  };

  return (
    <>
      <PageMeta title="Categories & models" description="Product master" />

      {canEdit ? (
        <div className="mb-3.5 flex justify-end">
          <Button
            type="button"
            className="h-10"
            onClick={() => setDialog({ kind: "add-category" })}
          >
            <Plus data-icon="inline-start" />
            Add category
          </Button>
        </div>
      ) : null}

      {isError ? (
        <ErrorState
          title="Couldn't load categories"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <CategoryTreeSkeleton />
      ) : !data?.length ? (
        <EmptyState
          title="No categories yet"
          description="Product categories appear here with their subcategories, models and certified technicians."
        />
      ) : (
        <CategoryTree
          categories={data}
          canEdit={canEdit}
          onAction={setDialog}
        />
      )}

      {/* One dialog is mounted at a time, driven by the same value the tree
          emits — so no two can be open at once and none can be left holding a
          stale row. */}
      <CategoryFormDialog
        open={dialog?.kind === "add-category" || dialog?.kind === "edit-category"}
        onOpenChange={(next) => !next && close()}
        category={dialog?.kind === "edit-category" ? dialog.category : undefined}
      />

      {dialog?.kind === "add-subcategory" || dialog?.kind === "edit-subcategory" ? (
        <SubcategoryFormDialog
          open
          onOpenChange={(next) => !next && close()}
          category={dialog.category}
          subcategory={
            dialog.kind === "edit-subcategory" ? dialog.subcategory : undefined
          }
        />
      ) : null}

      {dialog?.kind === "add-model" || dialog?.kind === "edit-model" ? (
        <ModelFormDialog
          open
          onOpenChange={(next) => !next && close()}
          subcategory={dialog.subcategory}
          model={dialog.kind === "edit-model" ? dialog.model : undefined}
        />
      ) : null}

      {dialog?.kind === "delete-category" ? (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && close()}
          title={`Remove ${dialog.category.name}?`}
          description="Tickets already filed under this category keep it. It stops appearing in new ticket entry and in technician onboarding."
          confirmLabel="Remove category"
          isPending={deleteCategory.isPending}
          onConfirm={() =>
            deleteCategory.mutate(dialog.category.id, {
              onSuccess: removed(dialog.category.name),
            })
          }
        />
      ) : null}

      {dialog?.kind === "delete-subcategory" ? (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && close()}
          title={`Remove ${dialog.subcategory.name}?`}
          description="No technician can be certified for it afterwards. Tickets already filed under it keep it."
          confirmLabel="Remove subcategory"
          isPending={deleteSubcategory.isPending}
          onConfirm={() =>
            deleteSubcategory.mutate(dialog.subcategory.id, {
              onSuccess: removed(dialog.subcategory.name),
            })
          }
        />
      ) : null}

      {dialog?.kind === "delete-model" ? (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && close()}
          title={`Remove ${dialog.model.name}?`}
          description="It stops appearing in ticket entry. Tickets that already name it are unaffected."
          confirmLabel="Remove model"
          isPending={deleteModel.isPending}
          onConfirm={() =>
            deleteModel.mutate(dialog.model.id, {
              onSuccess: removed(dialog.model.name),
            })
          }
        />
      ) : null}
    </>
  );
}
