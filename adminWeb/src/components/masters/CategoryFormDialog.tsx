import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
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
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useCreateCategory } from "@/hooks/useMasters";
import { cn } from "@/lib/utils";
import {
  CATEGORY_STATUSES,
  categorySchema,
  type CategoryFormValues,
} from "./categorySchema";

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
}: CategoryFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* The popup unmounts on close, so the form is fresh on every open. */}
        <CategoryForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({ onDone }: { onDone: () => void }) {
  const create = useCreateCategory();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", models: [{ name: "" }], status: "Active" },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "models" });

  // Zod's array-level message lands on `root`; the per-row messages sit on
  // each entry.
  const modelsError = errors.models?.root?.message ?? errors.models?.message;

  function submit(values: CategoryFormValues) {
    create.mutate(
      {
        name: values.name,
        models: values.models.map((m) => m.name),
        active: values.status === "Active",
      },
      {
        onSuccess: (saved) => {
          toast.add({
            title: `${saved.name} added`,
            description: `${saved.models.length} product ${
              saved.models.length === 1 ? "model" : "models"
            } · ${saved.active ? "Active" : "Paused"}.`,
          });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add category</DialogTitle>
        <DialogDescription>
          A category needs at least one product model — manual entry picks a
          model from this list.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="max-h-[60vh] gap-4 overflow-y-auto">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="category-name">Category name</FieldLabel>
          <Input
            id="category-name"
            placeholder="e.g. Dishwasher"
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

        <FieldSet data-invalid={modelsError ? true : undefined}>
          <FieldLegend variant="label" className="text-sm font-medium">
            Product models
          </FieldLegend>

          <div className="grid gap-2.5">
            {fields.map((row, i) => {
              const rowError = errors.models?.[i]?.name?.message;
              const id = `category-model-${i}`;
              return (
                <Field key={row.id} data-invalid={rowError ? true : undefined}>
                  <FieldLabel htmlFor={id} className="sr-only">
                    Product model {i + 1}
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      placeholder={`Model ${i + 1}`}
                      aria-invalid={rowError ? true : undefined}
                      aria-describedby={rowError ? `${id}-error` : undefined}
                      {...register(`models.${i}.name`)}
                    />
                    {/* Never below one — a category with no model can't be
                        picked on the manual entry form. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={fields.length === 1}
                      aria-label={`Remove product model ${i + 1}`}
                      onClick={() => remove(i)}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                  {rowError ? (
                    <FieldDescription
                      id={`${id}-error`}
                      role="alert"
                      className="text-danger"
                    >
                      {rowError}
                    </FieldDescription>
                  ) : null}
                </Field>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => append({ name: "" })}
          >
            <Plus data-icon="inline-start" aria-hidden />
            Add model
          </Button>

          {modelsError ? (
            <FieldDescription role="alert" className="text-danger">
              {modelsError}
            </FieldDescription>
          ) : null}
        </FieldSet>

        <FieldSet data-invalid={errors.status ? true : undefined}>
          <FieldLegend variant="label" className="text-sm font-medium">
            Status
          </FieldLegend>
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <RadioGroup
                aria-label="Status"
                value={field.value}
                onValueChange={field.onChange}
                aria-invalid={errors.status ? true : undefined}
                aria-describedby={
                  errors.status ? "category-status-error" : undefined
                }
                className="grid grid-cols-2 gap-2.5"
              >
                {CATEGORY_STATUSES.map((s) => (
                  <label
                    key={s}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-[13px] transition-colors",
                      field.value === s
                        ? "border-brand-500 bg-brand-100/40"
                        : "border-line hover:border-brand-400"
                    )}
                  >
                    <RadioGroupItem value={s} />
                    <span>{s}</span>
                  </label>
                ))}
              </RadioGroup>
            )}
          />
          <FieldDescription>
            Paused categories stay out of new ticket entry.
          </FieldDescription>
          {errors.status ? (
            <FieldDescription
              id="category-status-error"
              role="alert"
              className="text-danger"
            >
              {errors.status.message}
            </FieldDescription>
          ) : null}
        </FieldSet>
      </FieldGroup>

      {create.error ? (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-xs text-danger"
        >
          {create.error instanceof Error
            ? create.error.message
            : "Couldn't save the category"}
        </p>
      ) : null}

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Add category
        </Button>
      </DialogFooter>
    </form>
  );
}
