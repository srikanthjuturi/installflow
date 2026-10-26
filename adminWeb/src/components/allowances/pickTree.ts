/**
 * One tree shape for the speed-rule target picker, from the two sources that
 * can feed it — PURE, so the picker (`SpeedTargetPicker`) renders one thing and
 * never learns which door it came through.
 *
 *   - **staff** read the catalogue tree (`GET /masters/nodes`, `ProductNode[]`),
 *     which is already nested and carries prices and counts the picker ignores;
 *   - **franchise** principals read `GET /franchise/settings/speed/catalogue`
 *     (Task 11 W16): a FLAT, price-free list of nodes plus a flat list of
 *     models, which this file nests by `parentId`.
 *
 * Why not `masters/CategoryTree` for both — its rows print technician counts
 * and both prices, and the franchise catalogue is price-free and count-free by
 * design; reusing it would mean faking those numbers or forking its rows.
 */

import type { ProductNode } from "@/types/product";
import type { SpeedCatalogue } from "@/types/allowances";

export interface PickModel {
  id: string;
  name: string;
  brandName: string;
}

export interface PickNode {
  id: string;
  name: string;
  depth: number;
  /** Only a last sub-category holds products. */
  isLeaf: boolean;
  isActive: boolean;
  children: PickNode[];
  models: PickModel[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

/** Staff: `ProductNode[]` → `PickNode[]`. Only APPROVED models — a rule cannot sit on a product no ticket can be raised against. */
export function fromProductTree(nodes: readonly ProductNode[]): PickNode[] {
  const walk = (n: ProductNode): PickNode => ({
    id: n.id,
    name: n.name,
    depth: n.depth,
    isLeaf: n.isLeaf,
    isActive: n.isActive,
    children: n.children.map(walk),
    models: n.models
      .filter((m) => m.approvalStatus === "approved")
      .map((m) => ({ id: m.id, name: m.name, brandName: m.brandName }))
      .sort(byName),
  });
  return nodes.map(walk);
}

/**
 * Franchise: the flat catalogue → a nested tree, siblings and models sorted by
 * name. A node whose parent is missing from the list (or null) becomes a ROOT
 * rather than vanishing; a model whose node is missing is dropped (there is
 * nowhere to hang it).
 */
export function fromSpeedCatalogue(catalogue: SpeedCatalogue): PickNode[] {
  const made = new Map<string, PickNode>();
  for (const n of catalogue.nodes) {
    made.set(n.id, {
      id: n.id,
      name: n.name,
      depth: n.depth,
      isLeaf: n.isLeaf,
      isActive: n.isActive,
      children: [],
      models: [],
    });
  }

  const roots: PickNode[] = [];
  for (const n of catalogue.nodes) {
    const node = made.get(n.id)!;
    const parent = n.parentId ? made.get(n.parentId) : undefined;
    // A node that is its own ancestor must not loop; treat it as a root.
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  for (const m of catalogue.models) {
    made
      .get(m.nodeId)
      ?.models.push({ id: m.id, name: m.name, brandName: m.brandName });
  }

  const sortDeep = (list: PickNode[]) => {
    list.sort(byName);
    for (const n of list) {
      n.models.sort(byName);
      sortDeep(n.children);
    }
  };
  sortDeep(roots);
  return roots;
}
