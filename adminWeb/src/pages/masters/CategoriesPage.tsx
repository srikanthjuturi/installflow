import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import {
  CategoryTree,
  CategoryTreeSkeleton,
  type MasterAction,
} from "@/components/masters/CategoryTree";
import { masterNodeId } from "@/components/masters/nodeIds";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ModelFormDialog } from "@/components/masters/ModelFormDialog";
import { NodeFormDialog } from "@/components/masters/NodeFormDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useFeatureAccess } from "@/hooks/useAuth";
import {
  useDeleteModel,
  useDeleteNode,
  useNodeTree,
} from "@/hooks/useProductMaster";

/** The one dialog that is open, if any. `null` is "none". */
type OpenDialog = MasterAction | null;

export default function CategoriesPage() {
  // Inactive rows are shown here and nowhere else: this is the screen where a
  // paused category is un-paused, so hiding it would strand it.
  const { data, isLoading, isError, error, refetch } = useNodeTree(true);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const navigate = useNavigate();

  const { has } = useFeatureAccess();
  const canEdit = has("masters.edit");
  // Reading the rules is a different grant from editing the catalogue — an Area
  // Manager holds `jobs.assign` and can read them; see the API's `ReadRules`.
  const canSeeRules = has("settings.view") || has("jobs.assign");

  const deleteNode = useDeleteNode();
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
      <PageMeta title="Categories & products" description="Product master" />

      {canEdit ? (
        <div className="mb-3.5 flex justify-end">
          <Button
            type="button"
            size="toolbar"
            onClick={() => setDialog({ kind: "add-node", parent: null })}
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
          description="Product categories appear here with their sub-categories, products and certified technicians. Nest them as deep as your catalogue needs."
        />
      ) : (
        <CategoryTree
          nodes={data}
          canEdit={canEdit}
          onAction={setDialog}
          // The rules themselves live on one screen, scoped by a picker — one
          // form in two modes beats a second copy of it in a dialog here.
          onOpenRules={
            canSeeRules
              ? (node) => navigate(`/settings/rules?node=${node.id}`)
              : undefined
          }
        />
      )}

      {/* One dialog is mounted at a time, driven by the same value the tree
          emits — so no two can be open at once and none can be left holding a
          stale row. */}
      {dialog?.kind === "add-node" || dialog?.kind === "edit-node" ? (
        <NodeFormDialog
          open
          onOpenChange={(next) => !next && close()}
          parent={
            dialog.kind === "add-node"
              ? dialog.parent
              : // On an edit the parent is context, not a choice — a node
                // cannot move. Found by walking the tree rather than stored on
                // the action, so it is always the current row.
                findParent(data, dialog.node.parentId)
          }
          node={dialog.kind === "edit-node" ? dialog.node : undefined}
        />
      ) : null}

      {dialog?.kind === "add-model" || dialog?.kind === "edit-model" ? (
        <ModelFormDialog
          open
          onOpenChange={(next) => !next && close()}
          node={dialog.node}
          model={dialog.kind === "edit-model" ? dialog.model : undefined}
        />
      ) : null}

      {dialog?.kind === "delete-node" ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && close()}
          title={`Remove ${dialog.node.name}?`}
          description="Tickets already filed under it keep it. It stops appearing in new ticket entry and in technician onboarding. Anything nested underneath has to be removed first."
          confirmLabel="Remove category"
          isPending={deleteNode.isPending}
          onConfirm={() =>
            deleteNode.mutate(dialog.node.id, {
              onSuccess: removed(dialog.node.name),
            })
          }
        />
      ) : null}

      {dialog?.kind === "delete-model" ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && close()}
          title={`Remove ${dialog.model.name}?`}
          description="It stops appearing in ticket entry. Tickets that already name it are unaffected."
          confirmLabel="Remove product"
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

/** The node with this id, anywhere in the tree. Null for a root's parent. */
function findParent(
  tree: Parameters<typeof CategoryTree>[0]["nodes"] | undefined,
  parentId: string | null
) {
  if (!parentId) return null;
  const stack = [...(tree ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === parentId) return node;
    stack.push(...node.children);
  }
  return null;
}
