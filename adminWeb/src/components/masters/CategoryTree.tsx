import { ImageOff, MoreHorizontal, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { moneyPaise } from "@/utils/money";
import type { ProductModel, ProductNode } from "@/types/product";
import { MAX_NODE_DEPTH } from "@/types/product";
import { DEFAULT_ICON_KEY, PRODUCT_ICONS } from "./icons";
import { masterNodeId } from "./nodeIds";

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

interface CategoryTreeProps {
  nodes: ProductNode[];
  onAction: (action: MasterAction) => void;
  /** Presentation only — the server enforces `masters.edit` (hard rule 8). */
  canEdit: boolean;
  /** Opens Rules Config scoped to a node. Absent when the viewer cannot read
   *  rules, which is a different grant from editing the catalogue. */
  onOpenRules?: (node: ProductNode) => void;
}

/** "1 model" / "3 models" — the count is the point, so it reads correctly. */
function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Every product in this branch, at any depth. The header band's total. */
function modelsBelow(node: ProductNode): number {
  return (
    node.models.length +
    node.children.reduce((n, child) => n + modelsBelow(child), 0)
  );
}

/**
 * The catalogue, carried by real nesting — `ul > li > ul > li > …` — not by
 * indentation, exactly as TerritoryTree does it. A screen reader announces
 * "list, 2 items" at each level and can walk roots without reading every model;
 * sighted users get the same structure from the card bands and the rule.
 * Indentation alone would leave the relationship invisible to anyone not
 * looking at it — and it matters more now the depth is not fixed at two.
 */
export function CategoryTree({
  nodes,
  onAction,
  canEdit,
  onOpenRules,
}: CategoryTreeProps) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Product categories">
      {nodes.map((node) => (
        <li key={node.id} id={masterNodeId(node.id)}>
          <RootNode
            node={node}
            onAction={onAction}
            canEdit={canEdit}
            onOpenRules={onOpenRules}
          />
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        isActive ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"
      )}
    >
      {isActive ? "Active" : "Paused"}
    </span>
  );
}

/** A node that overrides an operating rule says so, once, quietly. */
function RulesPill() {
  return (
    <span className="rounded-full bg-status-assigned-bg px-2 py-0.5 text-[11px] font-medium text-brand-400">
      Custom rules
    </span>
  );
}

function RowMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label} />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        /* `DropdownMenuContent` is `w-(--anchor-width)` — it sizes itself to
           its TRIGGER, and this trigger is a 28px icon button. Only the
           `min-w-32` floor kept it visible at all, so "Rules for this category"
           and "Remove category" each wrapped onto two lines.

           Sized to its CONTENT instead, between a floor that keeps a short menu
           from looking cramped and a ceiling that keeps it inside the viewport
           on a phone — where the anchor-width default would never have
           overflowed, so the cap is what buys the freedom to ignore it. */
        className="w-auto min-w-48 max-w-[calc(100vw-2rem)]"
      >
        {items.map((item, i) => (
          <div key={item.label}>
            {item.danger && i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              onClick={item.onSelect}
              className={item.danger ? "text-danger" : undefined}
            >
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The actions any node offers, wherever it sits. */
function nodeMenuItems(
  node: ProductNode,
  onAction: (a: MasterAction) => void,
  onOpenRules?: (n: ProductNode) => void
) {
  const items: { label: string; onSelect: () => void; danger?: boolean }[] = [
    { label: "Edit category", onSelect: () => onAction({ kind: "edit-node", node }) },
  ];
  // One or the other, never both — the same rule the API enforces, so the menu
  // never offers something the save would refuse. A node that is marked as the
  // last sub-category takes products; anything else takes sub-categories.
  if (node.isLeaf) {
    items.push({
      label: "Add product",
      onSelect: () => onAction({ kind: "add-model", node }),
    });
  } else if (node.depth < MAX_NODE_DEPTH) {
    items.push({
      label: "Add sub-category",
      onSelect: () => onAction({ kind: "add-node", parent: node }),
    });
  }
  if (onOpenRules) {
    items.push({ label: "Rules for this category", onSelect: () => onOpenRules(node) });
  }
  items.push({
    label: "Remove category",
    danger: true,
    onSelect: () => onAction({ kind: "delete-node", node }),
  });
  return items;
}

function RootNode({
  node,
  onAction,
  canEdit,
  onOpenRules,
}: {
  node: ProductNode;
  onAction: (a: MasterAction) => void;
  canEdit: boolean;
  onOpenRules?: (n: ProductNode) => void;
}) {
  // Indexed rather than looked up through a helper: a function call here reads
  // to the React Compiler lint as a component being created during render.
  const Icon = PRODUCT_ICONS[node.iconKey] ?? PRODUCT_ICONS[DEFAULT_ICON_KEY];

  return (
    <Card className="[--card-spacing:0rem]">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 bg-surface-2 px-4.5 py-3.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-500 text-white"
          aria-hidden
        >
          <Icon className="size-4.5" />
        </span>
        <h2 className="text-[15px] font-semibold">{node.name}</h2>
        <StatusPill isActive={node.isActive} />
        {node.hasRuleOverrides ? <RulesPill /> : null}
        <span className="ml-auto text-xs text-ink-3">
          {count(node.children.length, "sub-category", "sub-categories")} ·{" "}
          {count(modelsBelow(node), "product")}
        </span>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAction({ kind: "add-node", parent: node })}
            >
              <Plus data-icon="inline-start" aria-hidden />
              Add sub-category
            </Button>
            {onOpenRules ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Rules for ${node.name}`}
                onClick={() => onOpenRules(node)}
              >
                <SlidersHorizontal aria-hidden />
              </Button>
            ) : null}
            <RowMenu
              label={`Actions for ${node.name}`}
              items={nodeMenuItems(node, onAction, onOpenRules)}
            />
          </div>
        ) : null}
      </div>

      {node.children.length === 0 && node.models.length === 0 ? (
        /* An empty category is information, not a row to hide: no technician
           can be certified for it and no ticket can name it. */
        <p className="px-4.5 py-4 text-xs text-ink-3">
          No sub-categories yet — a product hangs off a sub-category, so this
          category cannot be serviced until it has one.
        </p>
      ) : (
        <ul
          className="flex flex-col p-2.5"
          aria-label={`Sub-categories in ${node.name}`}
        >
          {node.children.map((child) => (
            <li key={child.id} id={masterNodeId(child.id)}>
              <ChildNode
                node={child}
                onAction={onAction}
                canEdit={canEdit}
                onOpenRules={onOpenRules}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Any node below a root, and its own children after it — the recursion that
 * used to be a second hand-written level.
 *
 * The indent is bounded by `MAX_NODE_DEPTH`, so it is a static class per level
 * rather than an interpolated one: `pl-${n}` is never generated by Tailwind and
 * would render as no padding at all (hard rule 1).
 */
const INDENT = ["", "pl-4", "pl-8", "pl-12", "pl-16", "pl-20"] as const;

function ChildNode({
  node,
  onAction,
  canEdit,
  onOpenRules,
}: {
  node: ProductNode;
  onAction: (a: MasterAction) => void;
  canEdit: boolean;
  onOpenRules?: (n: ProductNode) => void;
}) {
  const Icon = PRODUCT_ICONS[node.iconKey] ?? PRODUCT_ICONS[DEFAULT_ICON_KEY];
  const indent = INDENT[Math.min(node.depth - 1, INDENT.length - 1)];

  return (
    <div className={indent}>
      <div className="rounded-md px-3 py-2.75 transition-colors hover:bg-surface-2">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="grid size-7.5 shrink-0 place-items-center rounded-md bg-status-assigned-bg text-brand-400"
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-37.5">
            <h3 className="text-[13px] font-semibold">{node.name}</h3>
            <p className="text-[11px] text-ink-3">
              {/* "Can take a job here", which includes anyone certified above
                  this node — not "certified on exactly this row". */}
              {count(node.technicianCount, "technician")} can take these ·{" "}
              {node.isLeaf
                ? count(node.models.length, "product")
                : count(node.children.length, "sub-category", "sub-categories")}
            </p>
          </div>
          {node.isActive ? null : <StatusPill isActive={false} />}
          {node.hasRuleOverrides ? <RulesPill /> : null}
          {canEdit ? (
            <div className="ml-auto flex items-center gap-1">
              {/* The row offers exactly ONE of these, decided by the flag. A
                  tree that offered both everywhere could not say where a branch
                  was meant to end, and an empty node would look identical
                  whether it was unfinished or waiting for stock. */}
              {node.isLeaf ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction({ kind: "add-model", node })}
                >
                  <Plus data-icon="inline-start" aria-hidden />
                  Add product
                </Button>
              ) : node.depth < MAX_NODE_DEPTH ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction({ kind: "add-node", parent: node })}
                >
                  <Plus data-icon="inline-start" aria-hidden />
                  Add sub-category
                </Button>
              ) : null}
              <RowMenu
                label={`Actions for ${node.name}`}
                items={nodeMenuItems(node, onAction, onOpenRules)}
              />
            </div>
          ) : null}
        </div>

        {node.models.length > 0 ? (
          <ul
            className="mt-2 flex flex-wrap gap-1.5 pl-10.5"
            aria-label={`Products in ${node.name}`}
          >
            {node.models.map((model) => (
              <li key={model.id} id={masterNodeId(model.id)}>
                <ModelChip
                  node={node}
                  model={model}
                  onAction={onAction}
                  canEdit={canEdit}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {node.children.length > 0 ? (
        <ul
          className="flex flex-col"
          aria-label={`Sub-categories in ${node.name}`}
        >
          {node.children.map((child) => (
            <li key={child.id} id={masterNodeId(child.id)}>
              <ChildNode
                node={child}
                onAction={onAction}
                canEdit={canEdit}
                onOpenRules={onOpenRules}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A model is a chip, not a row: there are five or six per node and they carry
 * two facts each. The photo is the reason the chip has a thumbnail rather than
 * being plain text — a missing one is visible at a glance.
 */
function ModelChip({
  node,
  model,
  onAction,
  canEdit,
}: {
  node: ProductNode;
  model: ProductModel;
  onAction: (a: MasterAction) => void;
  canEdit: boolean;
}) {
  /* Brand and capacity ride inline because they are what tell two models apart
     at a glance; warranty is a detail you go looking for, so it stays in the
     tooltip rather than making every chip a third longer. */
  const detail = [
    model.vendorName || null,
    model.capacity,
    model.warrantyMonths === null
      ? null
      : `${model.warrantyMonths} month warranty`,
    // In the tooltip rather than on the chip: three service types would double
    // a chip's width, and this is a detail you go looking for once the brand
    // and size have told you which model you are looking at.
    model.serviceTypes.length ? model.serviceTypes.join(", ") : null,
    // The specs. On the chip they would not fit; in the tooltip they are what
    // somebody checking the catalogue actually came for.
    model.parameters.length
      ? model.parameters.map((p) => `${p.name}: ${p.value}`).join(" · ")
      : null,
    // Both prices, together, because the margin between them is the thing worth
    // reading and neither number means much alone. `technicianPayoutPaise` is
    // null only for a vendor caller — who never sees this screen — so the dash
    // should not appear here; it is left to `moneyPaise` rather than special
    // cased, because inventing a figure would be worse than showing one.
    `${moneyPaise(model.technicianPayoutPaise)} to technician`,
    `${moneyPaise(model.vendorPricePaise)} from vendor`,
  ].filter(Boolean);

  const body = (
    <>
      <span
        className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-3 text-ink-3"
        aria-hidden
      >
        {/* The first photo is the model's face everywhere a list draws one. */}
        {model.imageUrls[0] ? (
          <img
            src={model.imageUrls[0]}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <ImageOff className="size-3" />
        )}
      </span>
      <span className={cn(model.isActive ? undefined : "line-through")}>
        {model.name}
      </span>
      {/* The brand is what a technician reads first on a job card, so it earns
          its place on the chip rather than living only in the tooltip. */}
      {model.vendorName ? (
        <span className="text-[11px] font-medium text-brand-400">
          {model.vendorName}
        </span>
      ) : null}
      {model.capacity ? (
        <span className="text-[11px] font-normal text-ink-3">
          {model.capacity}
        </span>
      ) : null}
    </>
  );

  const title = detail.length
    ? `${model.name} · ${detail.join(" · ")}`
    : model.name;

  if (!canEdit) {
    return (
      <span
        title={title}
        className="flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1.25 text-xs font-medium text-ink-2"
      >
        {body}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={title}
            className="flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1.25 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-brand-500/40"
          />
        }
      >
        {body}
      </DropdownMenuTrigger>
      {/* Same anchor-width trap as `RowMenu` above, and worse here: the trigger
          is the chip itself, so the menu was as narrow as the product name
          happened to be. */}
      <DropdownMenuContent
        align="start"
        className="w-auto min-w-44 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuItem
          onClick={() => onAction({ kind: "edit-model", node, model })}
        >
          Edit product
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-danger"
          onClick={() => onAction({ kind: "delete-model", model })}
        >
          Remove product
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Two category cards in the real shape — header band, then sub-category rows. */
export function CategoryTreeSkeleton({
  categories = 2,
  subcategories = 3,
}: {
  categories?: number;
  subcategories?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: categories }).map((_, c) => (
        <Card key={c} className="[--card-spacing:0rem]">
          <div className="flex items-center gap-3 border-b border-line-2 bg-surface-2 px-4.5 py-3.5">
            <Skeleton className="size-9 shrink-0" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-3 w-32" />
          </div>
          <div className="flex flex-col p-2.5">
            {Array.from({ length: subcategories }).map((__, s) => (
              <div key={s} className="px-3 py-2.75">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-7.5 shrink-0" />
                  <div className="flex min-w-37.5 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-2.5 w-36" />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-10.5">
                  {Array.from({ length: 4 }).map((___, m) => (
                    <Skeleton key={m} className="h-6 w-24 rounded-md" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
