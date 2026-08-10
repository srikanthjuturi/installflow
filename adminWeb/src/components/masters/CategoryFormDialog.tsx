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
import { useCreateCategory, useUpdateCategory } from "@/hooks/useProductMaster";
import type { ProductCategory } from "@/types/product";
import { IconPicker } from "./IconPicker";
import { StatusField } from "./StatusField";
import {
  categorySchema,
  statusOf,
  type CategoryFormValues,
} from "./categorySchema";
import { DEFAULT_ICON_KEY } from "./icons";

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add. Pass a category to edit it in place. */
  category?: ProductCategory;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
}: CategoryFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the other two: the icon grid needs the room to lay out in
          a few rows rather than a dozen. */}
      <DialogContent className="sm:max-w-xl">
        {/* The popup unmounts on close, so the form is fresh on every open and
            an edit never opens holding the previous row's values. */}
        <CategoryForm category={category} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  category,
  onDone,
}: {
  category?: ProductCategory;
  onDone: () => void;
}) {
  const isEdit = category !== undefined;
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const pending = create.isPending || update.isPending;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name ?? "",
      iconKey: category?.iconKey ?? DEFAULT_ICON_KEY,
      status: statusOf(category?.isActive ?? true),
    },
  });

  function submit(values: CategoryFormValues) {
    const body = {
      name: values.name,
      iconKey: values.iconKey,
      isActive: values.status === "Active",
    };
    const done = (saved: ProductCategory) => {
      toast.add({
        title: `${saved.name} ${isEdit ? "updated" : "added"}`,
        description: `${saved.subcategories.length} subcategor${
          saved.subcategories.length === 1 ? "y" : "ies"
        } · ${saved.isActive ? "Active" : "Paused"}.`,
      });
      onDone();
    };

    if (isEdit) update.mutate({ id: category.id, ...body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit category" : "Add category"}</DialogTitle>
        <DialogDescription>
          A category groups the product types your technicians service. Add
          subcategories to it next — that is what a technician is certified for.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="max-h-[60vh] gap-4 overflow-y-auto">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="category-name">Category name</FieldLabel>
          <Input
            id="category-name"
            placeholder="e.g. Electric"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "category-name-error" : undefined}
            {...register("name")}
          />
          <FieldDescription>
            Certified technicians are counted from technician records, not set
            here.
          </FieldDescription>
          {errors.name ? (
            <FieldDescription
              id="category-name-error"
              role="alert"
              className="text-danger"
            >
              {errors.name.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.iconKey ? true : undefined}>
          <FieldLabel htmlFor="category-icon">Icon</FieldLabel>
          <Controller
            name="iconKey"
            control={control}
            render={({ field }) => (
              <IconPicker
                id="category-icon"
                label="Category icon"
                value={field.value}
                onChange={field.onChange}
                aria-invalid={errors.iconKey ? true : undefined}
                aria-describedby="category-icon-hint"
              />
            )}
          />
          <FieldDescription id="category-icon-hint">
            Shown here and in the technician app. Subcategories use it unless
            they pick their own.
          </FieldDescription>
        </Field>

        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <StatusField
              value={field.value}
              onChange={field.onChange}
              description="Paused categories stay out of new ticket entry."
              error={errors.status?.message}
              errorId="category-status-error"
            />
          )}
        />
      </FieldGroup>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Save changes" : "Add category"}
        </Button>
      </DialogFooter>
    </form>
  );
}
