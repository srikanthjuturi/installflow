import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ErrorState } from "@/components/shared/states";
import { useNodeTree } from "@/hooks/useProductMaster";
import { findNode, MAX_NODE_DEPTH, type ProductNode } from "@/types/product";

/** What the vendor is about to add — which decides what may be chosen. */
export type PickFor = "product" | "category";

/** The "no parent" choice when adding a category. Never a node id. */
const TOP_LEVEL = "__top__";

const TOP_LEVEL_OPTION: ComboboxOption = {
  value: TOP_LEVEL,
  label: "Top level (a new main category)",
};

/**
 * Where a vendor's NEW product or category goes.
 *
 * "My products" shows only the vendor's own work — its products, the
 * categories it created and the path above each — so it can no longer double
 * as the place to choose a category from: a brand-new vendor would see nothing
 * to file under. This is that choice, read with `purpose: "categories"`: the
 * company's categories with no products of anybody's in them. The server sends
 * no product at all for that purpose, so nothing here has to be filtered out.
 *
 * Mounted only while open, so the tree is fetched when somebody actually asks.
 *
 *   product    only a last sub-category takes products, so only those.
 *   category   the top level, or any category that may take a sub-category —
 *              not a last sub-category, and not one already at the depth limit.
 *              The same two rules `addMenuItems` applies to a row's menu.
 */
export function CategoryPickerDialog({
  open,
  onOpenChange,
  pickFor,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickFor: PickFor;
  /** The chosen category. Null only for a category at the top level. */
  onPick: (node: ProductNode | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <PickerForm pickFor={pickFor} onPick={onPick} />
      </DialogContent>
    </Dialog>
  );
}

function PickerForm({
  pickFor,
  onPick,
}: {
  pickFor: PickFor;
  onPick: (node: ProductNode | null) => void;
}) {
  const { data, isPending, isError, error, refetch } = useNodeTree(
    false,
    undefined,
    "categories"
  );

  const options = useMemo<ComboboxOption[]>(() => {
    const out: ComboboxOption[] = [];
    const walk = (node: ProductNode) => {
      const fits =
        pickFor === "product"
          ? node.isLeaf
          : !node.isLeaf && node.depth < MAX_NODE_DEPTH;
      // The whole path as the label: names are unique only among siblings, so
      // "LG" alone could be two rows — and typing the top level finds
      // everything under it.
      if (fits) out.push({ value: node.id, label: node.path.join(" › ") });
      node.children.forEach(walk);
    };
    (data ?? []).forEach(walk);
    return pickFor === "category" ? [TOP_LEVEL_OPTION, ...out] : out;
  }, [data, pickFor]);

  const [picked, setPicked] = useState<ComboboxOption | null>(
    pickFor === "category" ? TOP_LEVEL_OPTION : null
  );

  const forProduct = pickFor === "product";
  const nothingToPick = forProduct && !isPending && options.length === 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked) return;
    if (picked.value === TOP_LEVEL) {
      onPick(null);
      return;
    }
    const node = findNode(data, picked.value);
    if (node) onPick(node);
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{forProduct ? "Add product" : "Add category"}</DialogTitle>
        <DialogDescription>
          {forProduct
            ? "Choose the category it belongs in. Only a last sub-category holds products."
            : "Choose where the new category goes."}
        </DialogDescription>
      </DialogHeader>

      {isError ? (
        <ErrorState
          title="Couldn't load the categories"
          error={error}
          onRetry={() => refetch()}
        />
      ) : nothingToPick ? (
        <p className="rounded-md bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
          No category can take a product yet. Add a category first, and tick
          <em> This is the last sub-category</em> on the level that will hold
          the product.
        </p>
      ) : (
        <Field>
          <FieldLabel htmlFor="pick-category" required>
            {forProduct ? "Category" : "Goes under"}
          </FieldLabel>
          <Combobox
            id="pick-category"
            value={picked}
            onValueChange={setPicked}
            options={options}
            loading={isPending}
            autoHighlight
            placeholder="Search categories"
            emptyMessage="No category matches that"
            aria-describedby="pick-category-hint"
          />
          <FieldDescription id="pick-category-hint">
            {forProduct
              ? "Can't find the right one? Add a category first."
              : "Leave it at the top level for a new main category."}
          </FieldDescription>
        </Field>
      )}

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={!picked || isPending || isError}>
          Continue
        </Button>
      </DialogFooter>
    </form>
  );
}
