import type { IconKey } from "@/components/masters/icons";

/**
 * The product master: a recursive category tree, with priced products as leaves.
 *
 * It used to be fixed at three levels — category → subcategory → model — with
 * the depth encoded in the types themselves. *Electronics → TV → Android TV →
 * 32" Android* is four and could not be expressed. Categories at every level are
 * one `ProductNode` now, nesting through `children`; a `ProductModel` is still
 * its own thing, because it has a brand, photos, service types and two prices
 * that a category has none of.
 *
 * Everything carries a UUID `id`. The old flat `Category` was keyed by `name`,
 * which meant a rename silently orphaned every technician and ticket that
 * referenced it.
 *
 * A technician certifies on a NODE, at any depth, and **covers everything
 * beneath it** — certify somebody on *TV* and they are offered *Android TV* jobs
 * too, including levels added afterwards.
 */

/**
 * What a technician can be sent to do with a model.
 *
 * Mirrors SERVICE_TYPES in `api/app/core/service_types.py`. A model declares
 * which it supports, and that is what a ticket raised against it will be
 * allowed to ask for.
 */
export type ServiceType = "Installation + Demo" | "Tech Visit" | "Service";

/**
 * One free-text spec — `RAM` / `8 GB`.
 *
 * Untyped on both sides deliberately: a catalogue spec is read by a person,
 * never computed with, and "8 GB" and "2 years" want the same box. Typing the
 * value would mean a kind, a units vocabulary and a migration per addition.
 */
export interface Parameter {
  name: string;
  value: string;
}

export interface ProductModel {
  id: string;
  /** The catalogue node this product sits under. Always at depth >= 1. */
  nodeId: string;
  /** The brand — a vendor of this company. Mandatory. */
  vendorId: string;
  /** Resolved by the API, so no list fetches the vendor list to draw a row. */
  vendorName: string;
  name: string;
  /** At least one, always in catalogue order — the API normalises it. */
  serviceTypes: ServiceType[];
  /**
   * Size or rating — "43 inch", "7 kg", "340 L".
   *
   * Its own field rather than part of the name, which is where it lives in the
   * seeded rows and where it cannot be sorted, filtered or shown on its own.
   */
  capacity: string | null;
  /** 0–240. Null means nobody has recorded it yet, not "no warranty". */
  warrantyMonths: number | null;
  /** Prose about this product — a quirk, a handling note. Not a spec: it has no
   *  field name, and it is read as a sentence. */
  notes: string | null;
  /** Free-text specs, in the order they were entered. On the PRODUCT and
   *  nowhere else — a spec describes a thing you can install, and a category is
   *  a way of finding one. */
  parameters: Parameter[];
  /**
   * What a technician earns for one job on this model, in PAISE.
   *
   * `null` NEVER means unpriced — the column is NOT NULL. It means the caller
   * is a **vendor**, and the server withholds this from them: what we pay a
   * technician is not part of what a vendor bought. Ops always get a number.
   */
  technicianPayoutPaise: number | null;
  /** What the vendor is charged to raise one of these, in PAISE. Everyone who
   *  can see the model sees this — including the vendor, whose price it is. */
  vendorPricePaise: number;
  /**
   * Up to five http(s) URLs into blob storage, ordered — the first is the
   * thumbnail. The API rejects `data:` on purpose: a base64 photo in every list
   * response is expensive, so the file is uploaded and only its URL stored.
   */
  imageUrls: string[];
  isActive: boolean;
  sortOrder: number;
}

/** How deep the tree may go. Mirrors `MAX_NODE_DEPTH` in the API. */
export const MAX_NODE_DEPTH = 5;

export interface ProductNode {
  id: string;
  /** Null for a root category. */
  parentId: string | null;
  name: string;
  /** Distance from the root — 0 for a root. The tree indents on it. */
  depth: number;
  /** The breadcrumb, root first, INCLUDING this node's own name. Every
   *  flattened list labels itself with this, because names are only unique
   *  among siblings. */
  path: string[];
  /** Already resolved by the API — this node's icon, or the nearest ancestor's. */
  iconKey: IconKey;
  /** What is actually stored. `null` means "inherits", which the form shows. */
  ownIconKey: IconKey | null;
  /**
   * Is this the level products hang off?
   *
   * True and the row offers **Add product** and nothing deeper; false and it
   * offers **Add sub-category** and no products. Stored rather than derived
   * from "does it have products", so an EMPTY row still says which it is
   * waiting for instead of offering both.
   */
  isLeaf: boolean;
  /**
   * The field TEMPLATE products under this node start from.
   *
   * Names are the point; a value is an optional default. A template, not
   * inheritance: creating a product seeds its own fields from this list and the
   * product then owns what it saved, so editing this later never rewrites
   * products that already exist. Always empty on a non-leaf.
   */
  parameters: Parameter[];
  isActive: boolean;
  sortOrder: number;
  /** Technicians who could take a job here — certified on this node OR any
   *  ancestor of it, counted once each. Not "certified exactly here". */
  technicianCount: number;
  /** Whether this node overrides any operating rule. Just a badge; the values
   *  live on Configuration → Rules Config, scoped to the node. */
  hasRuleOverrides: boolean;
  children: ProductNode[];
  models: ProductModel[];
}

/* ----------------------------------------------------------------- inputs */

export interface CreateNodeInput {
  name: string;
  /** Omit or null for a root. Accepted only on CREATE — a node cannot move,
   *  because its ancestor chain is derived and moving it would mean rewriting
   *  the whole subtree. */
  parentId?: string | null;
  /** Omit to inherit the nearest ancestor's icon. */
  iconKey?: IconKey | null;
  /** "This is the last sub-category". Refused on a root. */
  isLeaf: boolean;
  /** The field template. Only accepted on a leaf. */
  parameters?: Parameter[];
  isActive: boolean;
}

export interface UpdateNodeInput {
  id: string;
  name?: string;
  iconKey?: IconKey | null;
  /** Refused while it would strand something — see `ProductNode.isLeaf`. */
  isLeaf?: boolean;
  /** Sent whole; an empty array clears the template. */
  parameters?: Parameter[];
  isActive?: boolean;
}

export interface CreateModelInput {
  nodeId: string;
  name: string;
  vendorId: string;
  serviceTypes: ServiceType[];
  capacity?: string | null;
  warrantyMonths?: number | null;
  notes?: string | null;
  parameters?: Parameter[];
  /** Both REQUIRED, in paise. The API columns are NOT NULL, so a model saved
   *  without them is one no ticket could be raised against. */
  technicianPayoutPaise: number;
  vendorPricePaise: number;
  imageUrls?: string[];
  isActive: boolean;
}

export interface UpdateModelInput {
  id: string;
  name?: string;
  /** Re-branding is allowed; clearing the brand is not. */
  vendorId?: string;
  /** Sent whole — omit to leave alone; an empty array is refused. */
  serviceTypes?: ServiceType[];
  capacity?: string | null;
  warrantyMonths?: number | null;
  notes?: string | null;
  parameters?: Parameter[];
  /** Repricing is allowed; UNpricing is not, so omit to leave alone — there is
   *  no null that clears these, the way there is for `capacity`. */
  technicianPayoutPaise?: number;
  vendorPricePaise?: number;
  /** Sent whole — an empty array clears the gallery. */
  imageUrls?: string[];
  isActive?: boolean;
}

/* ------------------------------------------------------------- flattening */

/**
 * The depth a technician certifies at — a main sub-category, the direct child
 * of a root. Mirrors `CERTIFY_DEPTH` in `api/app/core/product_tree.py`, which
 * enforces it and explains it; the API is the authority, this is the filter
 * that stops the picker offering what the API would refuse.
 */
export const CERTIFY_DEPTH = 1;

export interface NodeOption {
  id: string;
  /** The node's own name. */
  name: string;
  /** `TV › Android TV` — the path BELOW the root, which is what tells two
   *  identically named nodes apart in a flat list. Empty at the root. */
  pathLabel: string;
  iconKey: IconKey;
  depth: number;
  /** The ROOT of this node's branch — what a flat list groups by. */
  rootId: string;
  rootName: string;
  /** Whether this is the level products hang off. A picker that must end at a
   *  product offers only these; one for certification offers every node. */
  isLeaf: boolean;
  hasChildren: boolean;
  hasModels: boolean;
}

/**
 * Every node in the tree, depth-first, with its root and breadcrumb attached.
 *
 * The technician form, the eligibility shortlist and ticket intake all need a
 * flat pick list grouped by root; deriving it here keeps that grouping — and
 * the `TV › Android TV` labelling that stops two "32 inch" rows being
 * indistinguishable — in one place rather than in each consumer.
 *
 * Roots are INCLUDED. Certifying somebody on *Electronics* means "send them
 * anything", which is a real thing a small company wants to say; callers that
 * need a narrower set filter on `depth` or `hasModels`.
 */
export function flattenNodes(tree: ProductNode[] | undefined): NodeOption[] {
  const out: NodeOption[] = [];

  const walk = (node: ProductNode, root: ProductNode) => {
    out.push({
      id: node.id,
      name: node.name,
      // `path` includes the root, which is already the group heading — showing
      // it again in every row would be noise.
      pathLabel: node.path.slice(1).join(" › "),
      iconKey: node.iconKey,
      depth: node.depth,
      isLeaf: node.isLeaf,
      rootId: root.id,
      rootName: root.name,
      hasChildren: node.children.length > 0,
      hasModels: node.models.length > 0,
    });
    node.children.forEach((child) => walk(child, root));
  };

  (tree ?? []).forEach((root) => walk(root, root));
  return out;
}
