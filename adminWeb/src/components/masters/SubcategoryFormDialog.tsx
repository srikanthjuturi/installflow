import { Controller, useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  useCreateSubcategory,
  useUpdateSubcategory,
} from "@/hooks/useProductMaster";
import type { ProductCategory, ProductSubcategory } from "@/types/product";
import { IconPicker } from "./IconPicker";
import { StatusField } from "./StatusField";
import {
  statusOf,
  subcategorySchema,
  type SubcategoryFormValues,
} from "./categorySchema";

interface SubcategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The parent. Its icon is what an unset subcategory icon inherits. */
  category: ProductCategory;
  /** Omit to add. Pass a subcategory to edit it in place. */
  subcategory?: ProductSubcategory;
}

export function SubcategoryFormDialog({
  open,
  onOpenChange,
  category,
  subcategory,
}: SubcategoryFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <SubcategoryForm
          category={category}
          subcategory={subcategory}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function SubcategoryForm({
  category,
  subcategory,
  onDone,
}: {
  category: ProductCategory;
  subcategory?: ProductSubcategory;
  onDone: () => void;
}) {
  const isEdit = subcategory !== undefined;
  const create = useCreateSubcategory();
  const update = useUpdateSubcategory();
  const pending = create.isPending || update.isPending;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SubcategoryFormValues>({
    resolver: zodResolver(subcategorySchema),
    defaultValues: {
      name: subcategory?.name ?? "",
      // `ownIconKey`, not `iconKey`: the resolved value would pre-select the
      // parent's icon and quietly turn an inherited icon into a pinned one on
      // the next save.
      iconKey: subcategory?.ownIconKey ?? null,
      status: statusOf(subcategory?.isActive ?? true),
    },
  });

  function submit(values: SubcategoryFormValues) {
    const body = {
      name: values.name,
      iconKey: values.iconKey,
      isActive: values.status === "Active",
    };
    const done = (saved: ProductCategory) => {
      toast.add({
        title: `${values.name} ${isEdit ? "updated" : "added"}`,
        description: `In ${saved.name} · ${
          values.status === "Active" ? "Active" : "Paused"
        }.`,
      });
      onDone();
    };

    if (isEdit)
      update.mutate({ id: subcategory.id, ...body }, { onSuccess: done });
    else create.mutate({ categoryId: category.id, ...body }, { onSuccess: done });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Edit subcategory" : "Add subcategory"}
        </DialogTitle>
        <DialogDescription>
          In {category.name}. A technician is certified for subcategories, so
          this is what job offers match on.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="subcategory-name" required>
            Subcategory name
          </FieldLabel>
          <Input
            id="subcategory-name"
            placeholder="e.g. Television"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={
              errors.name ? "subcategory-name-error" : undefined
            }
            {...register("name")}
          />
          {errors.name ? (
            <FieldDescription
              id="subcategory-name-error"
              role="alert"
              className="text-danger"
            >
              {errors.name.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="subcategory-icon">Icon</FieldLabel>
          <Controller
            name="iconKey"
            control={control}
            render={({ field }) => (
              <IconPicker
                id="subcategory-icon"
                label="Subcategory icon"
                value={field.value}
                onChange={field.onChange}
                inheritFrom={{
                  iconKey: category.iconKey,
                  label: `Same as ${category.name}`,
                }}
                onInherit={() => field.onChange(null)}
                aria-describedby="subcategory-icon-hint"
              />
            )}
          />
          <FieldDescription id="subcategory-icon-hint">
            The technician app shows one tile per subcategory, so a Television
            and an Air Conditioner want different icons.
          </FieldDescription>
        </Field>

        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <StatusField
              value={field.value}
              onChange={field.onChange}
              description="Paused subcategories are not offered to technicians and stay out of new ticket entry."
              error={errors.status?.message}
              errorId="subcategory-status-error"
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
          {isEdit ? "Save changes" : "Add subcategory"}
        </Button>
      </DialogFooter>
    </form>
  );
}
