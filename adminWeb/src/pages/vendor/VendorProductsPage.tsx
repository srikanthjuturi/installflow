import { useMemo, useState } from "react";
import { FolderPlus, Plus } from "lucide-react";
import {
  CategoryTree,
  CategoryTreeSkeleton,
} from "@/components/masters/CategoryTree";
import {
  portalMenuItems,
  type MasterAction,
} from "@/components/masters/nodeMenu";
import { ModelFormDialog } from "@/components/masters/ModelFormDialog";
import { NodeFormDialog } from "@/components/masters/NodeFormDialog";
import { PageMeta } from "@/components/shared/PageMeta";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState, ErrorState } from "@/components/shared/states";
import {
  CategoryPickerDialog,
  type PickFor,
} from "@/components/vendor/CategoryPickerDialog";
import {
  RejectedProductsNotice,
  type RejectedProduct,
} from "@/components/vendor/RejectedProductsNotice";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/hooks/useAuth";
import { useFocusHighlight } from "@/hooks/useFocusHighlight";
import { useDeleteOwnModel, useNodeTree } from "@/hooks/useProductMaster";
import { findNode, type ProductNode } from "@/types/product";

/** The one dialog that is open, if any. `null` is "none". */
type OpenDialog = MasterAction | null;

/** Every rejected product in the tree, with the node it sits under. */
function collectRejected(nodes: ProductNode[]): RejectedProduct[] {
  const out: RejectedProduct[] = [];
  const walk = (node: ProductNode) => {
    for (const model of node.models) {
      if (model.approvalStatus === "rejected") out.push({ node, model });
    }
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/**
 * A vendor's own catalogue — the products they can raise tickets against, and
 * the ones still waiting.
 *
 * `/portal/products` rather than `/portal/categories`: the mental model is a
 * product list, and the categories are scaffolding to file into.
 *
 * The tree is read with `purpose: "catalogue"`, NOT the `intake` narrowing the
 * ticket form uses. Two different questions: intake asks "what can I raise a
 * ticket for", so it hides anything unapproved and prunes the branches that
 * empties; this asks "where do I put things", so a category with nothing in it
 * yet has to stay on screen — otherwise a vendor would watch the category they
 * just created vanish before they could file anything under it.
 *
 * The server narrows it to THEIR work: their products (it substitutes their
 * own vendor id whatever is asked for), the categories they created, and the
 * path above each. It used to send the company's whole tree, so a brand-new
 * vendor opened this page onto every other vendor's branches.
 *
 * That narrowing is why "Add product" and "Add category" open a picker rather
 * than relying on a row's menu: the category somebody needs to file under is
 * usually one they have nothing in yet, so it is not on this page. The picker
 * reads the company's categories with no products in them — see
 * `CategoryPickerDialog`.
 */
export default function VendorProductsPage() {
  const { data: me } = useMe();
  // `includeInactive` so a paused product is visible to the person who has to
  // ask about it, exactly as the ops Categories screen does.
  const { data, isLoading, isError, error, refetch } = useNodeTree(
    true,
    undefined,
    "catalogue"
  );
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // The step BEFORE an add dialog: which category it goes in. Separate from
  // `dialog` because choosing is what decides which add dialog opens next.
  const [picking, setPicking] = useState<PickFor | null>(null);
  const removeModel = useDeleteOwnModel();

  // Where a rejection notification lands.
  useFocusHighlight(!!data?.length);

  const rejected = useMemo(() => collectRejected(data ?? []), [data]);

  const vendor = me?.vendor;
  const submitter = vendor
    ? { vendorId: vendor.id, vendorName: vendor.name }
    : undefined;

  const close = () => setDialog(null);

  return (
    <>
      <PageMeta
        title="My products"
        description="The products you can raise tickets against"
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">My products</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="toolbar"
            variant="outline"
            onClick={() => setPicking("category")}
          >
            <FolderPlus data-icon="inline-start" />
            Add category
          </Button>
          <Button
            type="button"
            size="toolbar"
            onClick={() => setPicking("product")}
          >
            <Plus data-icon="inline-start" />
            Add product
          </Button>
        </div>
      </div>

      <RejectedProductsNotice
        rejected={rejected}
        onEdit={({ node, model }) =>
          setDialog({ kind: "edit-model", node, model })
        }
      />

      {isError ? (
        <ErrorState
          title="Couldn't load your products"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <CategoryTreeSkeleton />
      ) : !data?.length ? (
        <EmptyState
          title="No products yet"
          description="Add a product and we will price it. Until it is approved you cannot raise a ticket against it."
        />
      ) : (
        <>
          <CategoryTree
            nodes={data}
            canEdit
            onAction={setDialog}
            /* A shorter menu than the ops one. A category belongs to the
               company, so a vendor may edit only the ones it created
               (`isOwn`) — renaming anybody else's would change the catalogue
               for every other brand in the tenant, and the server refuses it
               too. Never "Remove category". The "Add" actions are built from
               the same rule the ops menu uses so neither can offer what a
               save would reject. */
            menuFor={(node) => portalMenuItems(node, setDialog)}
          />
          {/* Stated where the Pending chips are, rather than on the intake
              form. Somebody looking at a badge is the moment the sentence is
              worth reading, and it costs no request to say it here. */}
          <p className="mt-3.5 text-xs text-ink-3">
            A product waiting for approval cannot be ticketed yet. We will let
            you know as soon as it is priced.
          </p>
        </>
      )}

      {/* Choosing where a new product or category goes. Picking hands over to
          the add dialog below, so the two are never open together. */}
      {picking ? (
        <CategoryPickerDialog
          open
          onOpenChange={(next) => !next && setPicking(null)}
          pickFor={picking}
          onPick={(node) => {
            setPicking(null);
            if (picking === "product" && node) {
              setDialog({ kind: "add-model", node });
            } else if (picking === "category") {
              setDialog({ kind: "add-node", parent: node });
            }
          }}
        />
      ) : null}

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
                // cannot move. Same lookup the ops screen does.
                findNode(data, dialog.node.parentId)
          }
          node={dialog.kind === "edit-node" ? dialog.node : undefined}
          portal
        />
      ) : null}

      {dialog?.kind === "add-model" || dialog?.kind === "edit-model" ? (
        <ModelFormDialog
          open
          onOpenChange={(next) => !next && close()}
          node={dialog.node}
          model={dialog.kind === "edit-model" ? dialog.model : undefined}
          submitter={submitter}
        />
      ) : null}

      {dialog?.kind === "delete-model" ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && close()}
          title={`Remove ${dialog.model.name}?`}
          description="Tickets already raised against it keep it. It stops appearing when you raise a new one."
          confirmLabel="Remove product"
          isPending={removeModel.isPending}
          onConfirm={() =>
            removeModel.mutate(dialog.model.id, {
              onSuccess: () => {
                toast.add({ title: `${dialog.model.name} removed` });
                close();
              },
            })
          }
        />
      ) : null}
    </>
  );
}
