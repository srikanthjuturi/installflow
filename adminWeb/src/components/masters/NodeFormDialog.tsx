import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useCreateNode, useUpdateNode } from "@/hooks/useProductMaster";
import type { ProductNode } from "@/types/product";
import { IconPicker } from "./IconPicker";
import { ParameterFields } from "./ParameterFields";
import { StatusField } from "./StatusField";
import {
  cleanTemplate,
  nodeSchema,
  statusOf,
  type NodeFormValues,
} from "./categorySchema";

/**
 * One dialog for a category at ANY level.
 *
 * It replaces the `CategoryFormDialog` / `SubcategoryFormDialog` pair, which
 * were already near-identical — name, icon, status — and became the same row
 * type the moment the two tables merged. What differs between a root and a
 * child is now data (`parent`), not a component.
 */
interface NodeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where this node sits. Null means a root.
   *
   * On an EDIT it is the existing parent and is shown, not offered: a node
   * cannot move, because its ancestor chain is derived at create time and a
   * move would mean rewriting its whole subtree.
   */
  parent: ProductNode | null;
  /** Omit to add. Pass a node to edit it in place. */
  node?: ProductNode;
}

export function NodeFormDialog({
  open,
  onOpenChange,
  parent,
  node,
}: NodeFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <NodeForm
          parent={parent}
          node={node}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function NodeForm({
  parent,
  node,
  onDone,
}: {
  parent: ProductNode | null;
  node?: ProductNode;
  onDone: () => void;
}) {
  const isEdit = node !== undefined;
  const create = useCreateNode();
  const update = useUpdateNode();
  const pending = create.isPending || update.isPending;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NodeFormValues>({
    resolver: zodResolver(nodeSchema),
    defaultValues: {
      name: node?.name ?? "",
      // `ownIconKey`, not `iconKey`: the resolved value would pre-select the
      // ancestor's icon and quietly turn an inherited icon into a pinned one on
      // the next save.
      iconKey: node?.ownIconKey ?? null,
      isLeaf: node?.isLeaf ?? false,
      parameters: node?.parameters ?? [],
      status: statusOf(node?.isActive ?? true),
    },
  });

  // Reactive, not read once: ticking the box has to reveal the field editor in
  // the same interaction, which is the whole point of putting it here.
  const isLeaf = useWatch({ control, name: "isLeaf" });

  // A root never holds products, so the question does not arise there — and
  // asking it would offer a state the server refuses.
  const canBeLeaf = isEdit ? (node?.depth ?? 0) >= 1 : parent !== null;

  function submit(values: NodeFormValues) {
    const body = {
      name: values.name,
      iconKey: values.iconKey,
      isLeaf: canBeLeaf ? values.isLeaf : false,
      // Only the last sub-category holds products, so only it has a template.
      // Sent empty otherwise so un-ticking the box clears one that was there.
      parameters:
        canBeLeaf && values.isLeaf ? cleanTemplate(values.parameters) : [],
      isActive: values.status === "Active",
    };
    const done = () => {
      // From `parent`, NOT from what the save returned. Every masters write
      // answers with the whole affected ROOT subtree — that is what redraws the
      // tree — so `saved.name` was the root of the branch and never the place
      // the node went: adding under *Air Conditioner* confirmed "In Home
      // Appliances", and a new root confirmed that it was inside itself.
      //
      // The product dialog reads its location locally for the same reason.
      // A confirmation that states the wrong place is worse than no location at
      // all: checking it is the only thing anybody reads it for.
      const where = parent
        ? `In ${parent.path.join(" › ")}`
        : "A top-level category";
      toast.add({
        title: `${values.name} ${isEdit ? "updated" : "added"}`,
        description: `${where} · ${
          values.status === "Active" ? "Active" : "Paused"
        }.`,
      });
      onDone();
    };

    if (isEdit) update.mutate({ id: node.id, ...body }, { onSuccess: done });
    else
      create.mutate({ parentId: parent?.id ?? null, ...body }, { onSuccess: done });
  }

  const where = parent ? parent.path.join(" › ") : null;

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {isEdit
            ? "Edit category"
            : parent
              ? "Add sub-category"
              : "Add category"}
        </DialogTitle>
        <DialogDescription>
          {where ? (
            <>
              In {where}. A technician certified here covers everything beneath
              it, so nesting narrows what a job offer matches on.
            </>
          ) : (
            <>
              A top-level category. Products never hang off one directly — add a
              sub-category and tick <em>This is the last sub-category</em> on the
              level that holds them.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="node-name" required>
            Category name
          </FieldLabel>
          <Input
            id="node-name"
            placeholder={parent ? "e.g. Android TV" : "e.g. Electronics"}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "node-name-error" : undefined}
            {...register("name")}
          />
          {errors.name ? (
            <FieldDescription
              id="node-name-error"
              role="alert"
              className="text-danger"
            >
              {errors.name.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="node-icon">Icon</FieldLabel>
          <Controller
            name="iconKey"
            control={control}
            render={({ field }) => (
              <IconPicker
                id="node-icon"
                label="Category icon"
                value={field.value}
                onChange={field.onChange}
                inheritFrom={
                  parent
                    ? {
                        iconKey: parent.iconKey,
                        label: `Same as ${parent.name}`,
                      }
                    : undefined
                }
                onInherit={parent ? () => field.onChange(null) : undefined}
                aria-describedby="node-icon-hint"
              />
            )}
          />
          <FieldDescription id="node-icon-hint">
            {parent
              ? "Left unset, this inherits the nearest category above that has one."
              : "The technician app draws one tile per category, so a Television and an Air Conditioner want different icons."}
          </FieldDescription>
        </Field>

        {canBeLeaf ? (
          <Field orientation="horizontal">
            <Controller
              name="isLeaf"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="node-is-leaf"
                  checked={field.value}
                  onCheckedChange={(next) => field.onChange(next === true)}
                  aria-describedby="node-is-leaf-hint"
                />
              )}
            />
            <div>
              <FieldLabel htmlFor="node-is-leaf" className="font-normal">
                This is the last sub-category
              </FieldLabel>
              <FieldDescription id="node-is-leaf-hint">
                Products hang off this level instead of more sub-categories. It
                cannot be unticked while products are on it, or ticked while
                sub-categories are.
              </FieldDescription>
            </div>
          </Field>
        ) : null}

        {/* The field template, and only once this IS the last sub-category —
            a node that holds no products has nothing to template. Naming the
            fields here once is what stops somebody retyping "Panel" and "RAM"
            on every product underneath. */}
        {canBeLeaf && isLeaf ? (
          <ParameterFields
            control={control}
            register={register}
            name="parameters"
            errors={errors}
            idPrefix="node"
            hint="Every product added here starts with these fields ready to fill in. A value here is just a default — the product decides its own."
          />
        ) : null}

        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <StatusField
              value={field.value}
              onChange={field.onChange}
              description="Pausing a category also takes everything under it out of new ticket entry and out of the job pool."
              error={errors.status?.message}
              errorId="node-status-error"
            />
          )}
        />
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {isEdit
            ? "Save changes"
            : parent
              ? "Add sub-category"
              : "Add category"}
        </Button>
      </DialogFooter>
    </form>
  );
}
