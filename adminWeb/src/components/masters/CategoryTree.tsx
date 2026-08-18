import { ImageOff, MoreHorizontal, Plus } from "lucide-react";
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
import type {
  ProductCategory,
  ProductModel,
  ProductSubcategory,
} from "@/types/product";
import { DEFAULT_ICON_KEY, PRODUCT_ICONS } from "./icons";

/**
 * Everything the tree can ask the page to do. One union beats eight callback
 * props, and it keeps the page's dialog state a single discriminated value
 * rather than eight booleans that can all be true at once.
 */
export type MasterAction =
  | { kind: "edit-category"; category: ProductCategory }
  | { kind: "delete-category"; category: ProductCategory }
  | { kind: "add-subcategory"; category: ProductCategory }
  | {
      kind: "edit-subcategory";
      category: ProductCategory;
      subcategory: ProductSubcategory;
    }
  | { kind: "delete-subcategory"; subcategory: ProductSubcategory }
  | { kind: "add-model"; subcategory: ProductSubcategory }
  | { kind: "edit-model"; subcategory: ProductSubcategory; model: ProductModel }
  | { kind: "delete-model"; model: ProductModel };

interface CategoryTreeProps {
  categories: ProductCategory[];
  onAction: (action: MasterAction) => void;
  /** Presentation only — the server enforces `masters.edit` (hard rule 8). */
  canEdit: boolean;
}

/** "1 model" / "3 models" — the count is the point, so it reads correctly. */
function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Category → subcategory → model, carried by real nesting —
 * `ul > li > ul > li > ul > li` — not by indentation, exactly as TerritoryTree
 * does it. A screen reader announces "list, 2 items" at each level and can walk
 * categories without reading every model; sighted users get the same structure
 * from the card bands. Indentation alone would leave the relationship invisible
 * to anyone not looking at it.
 */
export function CategoryTree({
  categories,
  onAction,
  canEdit,
}: CategoryTreeProps) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Product categories">
      {categories.map((category) => (
        <li key={category.id}>
          <CategoryNode
            category={category}
            onAction={onAction}
            canEdit={canEdit}
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
      <DropdownMenuContent align="end">
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

function CategoryNode({
  category,
  onAction,
  canEdit,
}: {
  category: ProductCategory;
  onAction: (a: MasterAction) => void;
  canEdit: boolean;
}) {
  // Indexed rather than looked up through a helper: a function call here reads
  // to the React Compiler lint as a component being created during render.
  const Icon = PRODUCT_ICONS[category.iconKey] ?? PRODUCT_ICONS[DEFAULT_ICON_KEY];
  const modelCount = category.subcategories.reduce(
    (n, s) => n + s.models.length,
    0
  );

  return (
    <Card className="[--card-spacing:0rem]">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 bg-surface-2 px-4.5 py-3.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-500 text-white"
          aria-hidden
        >
          <Icon className="size-4.5" />
        </span>
        <h2 className="text-[15px] font-semibold">{category.name}</h2>
        <StatusPill isActive={category.isActive} />
        <span className="ml-auto text-xs text-ink-3">
          {count(category.subcategories.length, "subcategory", "subcategories")}{" "}
          · {count(modelCount, "model")}
        </span>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAction({ kind: "add-subcategory", category })}
            >
              <Plus data-icon="inline-start" aria-hidden />
              Add subcategory
            </Button>
            <RowMenu
              label={`Actions for ${category.name}`}
              items={[
                {
                  label: "Edit category",
                  onSelect: () => onAction({ kind: "edit-category", category }),
                },
                {
                  label: "Remove category",
                  danger: true,
                  onSelect: () =>
                    onAction({ kind: "delete-category", category }),
                },
              ]}
            />
          </div>
        ) : null}
      </div>

      {category.subcategories.length === 0 ? (
        /* An empty category is information, not a row to hide: no technician
           can be certified for it and no ticket can name it. */
        <p className="px-4.5 py-4 text-xs text-ink-3">
          No subcategories yet — a technician is certified for subcategories, so
          this category cannot be serviced until it has one.
        </p>
      ) : (
        <ul
          className="flex flex-col p-2.5"
          aria-label={`Subcategories in ${category.name}`}
        >
          {category.subcategories.map((subcategory) => (
            <li key={subcategory.id}>
              <SubcategoryNode
                category={category}
                subcategory={subcategory}
                onAction={onAction}
                canEdit={canEdit}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SubcategoryNode({
  category,
  subcategory,
  onAction,
  canEdit,
}: {
  category: ProductCategory;
  subcategory: ProductSubcategory;
  onAction: (a: MasterAction) => void;
  canEdit: boolean;
}) {
  const Icon =
    PRODUCT_ICONS[subcategory.iconKey] ?? PRODUCT_ICONS[DEFAULT_ICON_KEY];

  return (
    <div className="rounded-md px-3 py-2.75 transition-colors hover:bg-surface-2">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="grid size-7.5 shrink-0 place-items-center rounded-md bg-status-assigned-bg text-brand-400"
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-37.5">
          <h3 className="text-[13px] font-semibold">{subcategory.name}</h3>
          <p className="text-[11px] text-ink-3">
            {count(subcategory.technicianCount, "technician")} certified ·{" "}
            {count(subcategory.models.length, "model")}
          </p>
        </div>
        {subcategory.isActive ? null : <StatusPill isActive={false} />}
        {canEdit ? (
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onAction({ kind: "add-model", subcategory })}
            >
              <Plus data-icon="inline-start" aria-hidden />
              Add model
            </Button>
            <RowMenu
              label={`Actions for ${subcategory.name}`}
              items={[
                {
                  label: "Edit subcategory",
                  onSelect: () =>
                    onAction({ kind: "edit-subcategory", category, subcategory }),
                },
                {
                  label: "Remove subcategory",
                  danger: true,
                  onSelect: () =>
                    onAction({ kind: "delete-subcategory", subcategory }),
                },
              ]}
            />
          </div>
        ) : null}
      </div>

      {subcategory.models.length > 0 ? (
        <ul
          className="mt-2 flex flex-wrap gap-1.5 pl-10.5"
          aria-label={`Product models in ${subcategory.name}`}
        >
          {subcategory.models.map((model) => (
            <li key={model.id}>
              <ModelChip
                subcategory={subcategory}
                model={model}
                onAction={onAction}
                canEdit={canEdit}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A model is a chip, not a row: there are five or six per subcategory and they
 * carry two facts each. The photo is the reason the chip has a thumbnail rather
 * than being plain text — a missing one is visible at a glance.
 */
function ModelChip({
  subcategory,
  model,
  onAction,
  canEdit,
}: {
  subcategory: ProductSubcategory;
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
            className="flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1.25 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-1 focus-visible:ring-3 focus-visible:ring-brand-500/40"
          />
        }
      >
        {body}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => onAction({ kind: "edit-model", subcategory, model })}
        >
          Edit model
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-danger"
          onClick={() => onAction({ kind: "delete-model", model })}
        >
          Remove model
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Two category cards in the real shape — header band, then subcategory rows. */
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
