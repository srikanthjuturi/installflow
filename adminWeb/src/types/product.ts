import type { IconKey } from "@/components/masters/icons";
import type { ApprovalStatus } from "./approval";

/**
 * The product master: a recursive category tree, with priced products as leaves.
 *
 * It used to be fixed at three levels — category → subcategory → model — with
 * the depth encoded in the types themselves. *Electronics → TV → Android TV →
 * 32" Android* is four and could not be expressed. Categories at every level are
 * one `ProductNode` now, nesting through `children`; a `ProductModel` is still
 * its own thing, because it has a brand, photos, service types, an approval
 * state and — once approved — two prices that a category has none of.
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
  /** The VENDOR who supplies it — a company this company installs for. */
  vendorId: string;
  /** Resolved by the API, so no list fetches the vendor list to draw a row. */
  vendorName: string;
  /**
   * The brand printed on the unit — one of that vendor's approved brands.
   * Mandatory, and what a row shows; the vendor is the company behind it.
   */
  brandId: string;
  brandName: string;
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
   * `null` means one of **two** things, and they are indistinguishable on the
   * wire on purpose:
   *
   *  - the caller is a **vendor**, and the server withholds this from them —
   *    what we pay a technician is not part of what a vendor bought;
   *  - the product is **not approved yet**, so nobody has set a price at all.
   *
   * Both mean "no figure for you", so nothing has to tell them apart. What a
   * renderer must not do is print a dash: "— to technician" reads as a number
   * that failed to load. Omit the line instead.
   */
  technicianPayoutPaise: number | null;
  /**
   * What the vendor is charged to raise one of these, in PAISE.
   *
   * Never masked — everyone who can see the model sees this, including the
   * vendor, whose price it is. `null` here therefore means only the second
   * thing above: a product waiting for approval has no agreed price yet.
   */
  vendorPricePaise: number | null;
  /**
   * Where this product sits between "a vendor asked for it" and "somebody can
   * be sent to install it".
   *
   * A third axis, orthogonal to `isActive` (paused) and to deletion. A vendor
   * may add products to their own book but not price them, so a submission
   * waits until a National Head sets both figures. Only `approved` can be
   * ticketed, and the intake tree never offers anything else.
   */
  approvalStatus: ApprovalStatus;
  /** Why it was refused, in words the vendor reads. Null unless rejected. */
  rejectionReason: string | null;
  /**
   * Up to five http(s) URLs into blob storage, ordered — the first is the
   * thumbnail. The API rejects `data:` on purpose: a base64 photo in every list
   * response is expensive, so the file is uploaded and only its URL stored.
   */
  imageUrls: string[];
  isActive: boolean;
  sortOrder: number;
  /**
   * How many serial numbers this model covers.
   *
   * **Zero is a state, not an empty list.** Ticket intake checks a vendor's
   * typed serial against this model only once at least one is loaded, so zero
   * means the model is not checked at all — which is why the row shows it
   * rather than leaving it to be found by opening the panel.
   */
  serialCount: number;
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
  /** Whether the signed-in VENDOR created this category — the ones the portal
   *  offers "Edit category" on. Always false for staff, who edit every one. */
  isOwn: boolean;
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
  /** One of that vendor's APPROVED brands — the server refuses anything else. */
  brandId: string;
  serviceTypes: ServiceType[];
  capacity?: string | null;
  warrantyMonths?: number | null;
  notes?: string | null;
  parameters?: Parameter[];
  /**
   * Both REQUIRED, in paise — of an OPS caller, which is the only caller this
   * input serves. A model staff save without them is one no ticket could be
   * raised against.
   *
   * A vendor submits through `SubmitModelInput`, which carries no price at all,
   * and a National Head sets both at approval. The API is the authority on
   * which caller it is talking to: `POST /masters/nodes/{id}/models` is
   * staff-only, and the vendor's own path is `/masters/portal/...`.
   */
  technicianPayoutPaise: number;
  vendorPricePaise: number;
  imageUrls?: string[];
  isActive: boolean;
}

/**
 * What a VENDOR submits for their own book.
 *
 * No `vendorId` — the server reads it off the session, because an id in a body
 * is an assertion rather than a fact. No prices — a National Head types both at
 * approval. No `isActive` — pausing is how ops withdraw a product, and a second
 * "not available" switch in the submitter's hands is two answers to one
 * question.
 */
export interface SubmitModelInput {
  nodeId: string;
  name: string;
  /** One of the vendor's OWN approved brands. */
  brandId: string;
  serviceTypes: ServiceType[];
  capacity?: string | null;
  warrantyMonths?: number | null;
  notes?: string | null;
  parameters?: Parameter[];
  imageUrls?: string[];
}

/**
 * The same fields, all optional. An approved product stays approved; a
 * rejected one that actually changes goes back to pending.
 */
export type ResubmitModelInput = { id: string } & Partial<
  Omit<SubmitModelInput, "nodeId">
>;

export interface UpdateModelInput {
  id: string;
  name?: string;
  /** Moving it to another vendor is allowed, and needs a brand of that vendor. */
  vendorId?: string;
  /** Re-branding is allowed; clearing the brand is not. */
  brandId?: string;
  /** Sent whole — omit to leave alone; an empty array is refused. */
  serviceTypes?: ServiceType[];
  capacity?: string | null;
  warrantyMonths?: number | null;
  notes?: string | null;
  parameters?: Parameter[];
  /**
   * Repricing is allowed; UNpricing is not, so omit to leave alone — there is
   * no null that clears these, the way there is for `capacity`.
   *
   * The columns became nullable when vendors could submit products, but that
   * null belongs to the approval flow and means "not priced yet". An ops edit
   * cannot reach it, and the server would refuse it on an approved row anyway.
   */
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

/**
 * The node with this id, anywhere in the tree. Null for a missing id — which
 * is also what a root's `parentId` asks for.
 *
 * What an edit dialog is given as a node's parent: found by walking the tree
 * rather than stored on the action, so it is always the current row.
 */
export function findNode(
  tree: ProductNode[] | undefined,
  id: string | null
): ProductNode | null {
  if (!id) return null;
  const stack = [...(tree ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    stack.push(...node.children);
  }
  return null;
}

/* ── model-wise serial numbers ─────────────────────────────────────────────── */

/**
 * One serial number a product model is known to cover.
 *
 * ## An EMPTY list means intake is NOT checked for that model
 *
 * `POST /tickets` refuses a serial only when the model has at least one of
 * these loaded. That is deliberate — it is what let the feature ship against a
 * live catalogue with no backfill — but it means "0 serials" is a meaningful
 * state and not merely an empty list, which is why the count is shown on the
 * model rather than left to be discovered by opening the panel.
 */
export interface ProductModelSerial {
  id: string;
  serial: string;
  createdAt: string;
}

/** Matches `product_model_serials.serial` and `tickets.serialNumber`, both 64. */
export const MAX_SERIAL_LENGTH = 64;

/** Mirrors `MAX_SERIALS_PER_REQUEST` in `api/app/features/masters/schemas.py`. */
export const MAX_SERIALS_PER_REQUEST = 500;

export interface SerialAddResult {
  added: number;
  /** Already on the model. Reported, never an error — re-pasting an
   *  overlapping block is how somebody tops a model up. */
  duplicates: number;
  /** What the model holds afterwards. */
  total: number;
}

export interface SerialReject {
  row: number | null;
  serial: string | null;
  reason: string;
}

/** The same two-pass shape as geography's `ImportReport`. */
export interface SerialImportReport {
  dryRun: boolean;
  rowsRead: number;
  added: number;
  /** Present more than once in the FILE — a mistake in the sheet. */
  duplicatesInFile: number;
  /** Overlapping what the model already holds — expected on a top-up. */
  alreadyPresent: number;
  rejected: number;
  /** Capped; `rejected` carries the true total. */
  rejects: SerialReject[];
  /** What the model holds after the import. On a dry run, what it WOULD hold. */
  total: number;
}

/**
 * The product a serial number belongs to — what the intake form fills from.
 *
 * Carries the NODE as well as the model because the form's category drill-down
 * is a chain of node ids: a match naming only the model would fill the last box
 * and leave the ones above it empty.
 */
export interface SerialMatch {
  modelId: string;
  modelName: string;
  nodeId: string;
  /** Root first, including the node's own name — the breadcrumb shown back. */
  nodePath: string[];
  serviceTypes: ServiceType[];
  /** As STORED, not as typed. The form writes this back so a serial entered in
   *  the wrong case is corrected in front of the user. */
  serial: string;
}

/**
 * The id path from a root down to `nodeId`, for seeding the drill-down.
 *
 * The sibling of `resolveChain` in `ManualEntryForm`, which goes the other way:
 * that turns a picked chain into nodes, this turns a node into the chain that
 * would have picked it. Returns null when the node is not in this tree, which
 * is a real answer rather than a failure — an intake tree hides unapproved and
 * paused branches, and a product the form cannot offer must not be filled in.
 */
export function nodeIdPath(
  tree: ProductNode[] | undefined,
  nodeId: string
): string[] | null {
  const walk = (nodes: ProductNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      const here = [...trail, node.id];
      if (node.id === nodeId) return here;
      const deeper = walk(node.children, here);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(tree ?? [], []);
}
