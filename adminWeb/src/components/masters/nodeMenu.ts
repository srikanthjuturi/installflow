import { MAX_NODE_DEPTH } from "@/types/product";
import type { ProductModel, ProductNode } from "@/types/product";

/**
 * Everything the tree can ask the page to do. One union beats eight callback
 * props, and it keeps the page's dialog state a single discriminated value
 * rather than eight booleans that can all be true at once.
 *
 * There is no `add-category` / `add-subcategory` split any more: both are
 * `add-node`, differing only in whether a parent came with it. That is the
 * whole shape of the change — a level is a `depth`, not a kind of row.
 */
export type MasterAction =
  | { kind: "add-node"; parent: ProductNode | null }
  | { kind: "edit-node"; node: ProductNode }
  | { kind: "delete-node"; node: ProductNode }
  | { kind: "add-model"; node: ProductNode }
  | { kind: "edit-model"; node: ProductNode; model: ProductModel }
  | { kind: "delete-model"; model: ProductModel };

export interface NodeMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * What a node offers under "Add", and nothing else.
 *
 * Split out because it is the whole of a VENDOR's node menu: a category is
 * company-wide, so somebody who files products into one may not rename it or
 * remove it for every other brand in the tenant. Exported so the portal builds
 * its menu from the same rule rather than re-deriving which of `is_leaf`'s two
 * branches applies.
 */
export function addMenuItems(
  node: ProductNode,
  onAction: (a: MasterAction) => void
): NodeMenuItem[] {
  // One or the other, never both — the same rule the API enforces, so the menu
  // never offers something the save would refuse. A node that is marked as the
  // last sub-category takes products; anything else takes sub-categories.
  if (node.isLeaf) {
    return [
      {
        label: "Add product",
        onSelect: () => onAction({ kind: "add-model", node }),
      },
    ];
  }
  if (node.depth < MAX_NODE_DEPTH) {
    return [
      {
        label: "Add sub-category",
        onSelect: () => onAction({ kind: "add-node", parent: node }),
      },
    ];
  }
  return [];
}
