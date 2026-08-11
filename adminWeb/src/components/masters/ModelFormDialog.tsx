import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImageOff } from "lucide-react";
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
import { useCreateModel, useUpdateModel } from "@/hooks/useProductMaster";
import type {
  ProductCategory,
  ProductModel,
  ProductSubcategory,
} from "@/types/product";
import { StatusField } from "./StatusField";
import { modelSchema, statusOf, type ModelFormValues } from "./categorySchema";

interface ModelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subcategory: ProductSubcategory;
  /** Omit to add. Pass a model to edit it in place. */
  model?: ProductModel;
}

export function ModelFormDialog({
  open,
  onOpenChange,
  subcategory,
  model,
}: ModelFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <ModelForm
          subcategory={subcategory}
          model={model}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ModelForm({
  subcategory,
  model,
  onDone,
}: {
  subcategory: ProductSubcategory;
  model?: ProductModel;
  onDone: () => void;
}) {
  const isEdit = model !== undefined;
  const create = useCreateModel();
  const update = useUpdateModel();
  const pending = create.isPending || update.isPending;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ModelFormValues>({
    resolver: zodResolver(modelSchema),
    defaultValues: {
      name: model?.name ?? "",
      capacity: model?.capacity ?? "",
      warrantyMonths:
        model?.warrantyMonths === null || model?.warrantyMonths === undefined
          ? ""
          : String(model.warrantyMonths),
      imageUrl: model?.imageUrl ?? "",
      status: statusOf(model?.isActive ?? true),
    },
  });

  // Subscribes to just this field, and unlike `watch()` does not opt the whole
  // form out of the React Compiler.
  const imageUrl = useWatch({ control, name: "imageUrl" });
  const previewable = /^https?:\/\//i.test(imageUrl ?? "");

  function submit(values: ModelFormValues) {
    const body = {
      name: values.name,
      // An empty box means "not recorded", which the API stores as null —
      // never an empty string, so "unknown" and "blank" cannot diverge.
      capacity: values.capacity.trim() || null,
      warrantyMonths: values.warrantyMonths.trim()
        ? Number(values.warrantyMonths)
        : null,
      imageUrl: values.imageUrl.trim() || null,
      isActive: values.status === "Active",
    };
    const done = (saved: ProductCategory) => {
      toast.add({
        title: `${values.name} ${isEdit ? "updated" : "added"}`,
        description: `In ${saved.name} · ${subcategory.name}.`,
      });
      onDone();
    };

    if (isEdit) update.mutate({ id: model.id, ...body }, { onSuccess: done });
    else
      create.mutate(
        { subcategoryId: subcategory.id, ...body },
        { onSuccess: done }
      );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Edit product model" : "Add product model"}
        </DialogTitle>
        <DialogDescription>
          In {subcategory.name}. Ticket intake picks a model from this list.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="max-h-[60vh] gap-4 overflow-y-auto">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="model-name">Model name</FieldLabel>
          <Input
            id="model-name"
            placeholder={'e.g. 43" 4K UHD'}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "model-name-error" : undefined}
            {...register("name")}
          />
          {errors.name ? (
            <FieldDescription
              id="model-name-error"
              role="alert"
              className="text-danger"
            >
              {errors.name.message}
            </FieldDescription>
          ) : null}
        </Field>

        {/* Both optional, and side by side because they are read together —
            "43 inch, 24 months" is one thought about the unit. */}
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.capacity ? true : undefined}>
            <FieldLabel htmlFor="model-capacity">Capacity / size</FieldLabel>
            <Input
              id="model-capacity"
              placeholder="e.g. 43 inch, 7 kg, 340 L"
              aria-invalid={errors.capacity ? true : undefined}
              aria-describedby={
                errors.capacity ? "model-capacity-error" : "model-capacity-hint"
              }
              {...register("capacity")}
            />
            {errors.capacity ? (
              <FieldDescription
                id="model-capacity-error"
                role="alert"
                className="text-danger"
              >
                {errors.capacity.message}
              </FieldDescription>
            ) : (
              <FieldDescription id="model-capacity-hint">
                Optional. Kept apart from the name so it can be read on its own.
              </FieldDescription>
            )}
          </Field>

          <Field data-invalid={errors.warrantyMonths ? true : undefined}>
            <FieldLabel htmlFor="model-warranty">Warranty (months)</FieldLabel>
            <Input
              id="model-warranty"
              inputMode="numeric"
              placeholder="e.g. 24"
              aria-invalid={errors.warrantyMonths ? true : undefined}
              aria-describedby={
                errors.warrantyMonths
                  ? "model-warranty-error"
                  : "model-warranty-hint"
              }
              {...register("warrantyMonths")}
            />
            {errors.warrantyMonths ? (
              <FieldDescription
                id="model-warranty-error"
                role="alert"
                className="text-danger"
              >
                {errors.warrantyMonths.message}
              </FieldDescription>
            ) : (
              <FieldDescription id="model-warranty-hint">
                Optional. Months, not years.
              </FieldDescription>
            )}
          </Field>
        </FieldGroup>

        <Field data-invalid={errors.imageUrl ? true : undefined}>
          <FieldLabel htmlFor="model-image">Photo link (optional)</FieldLabel>
          <div className="flex items-start gap-3">
            {/* A live preview is the only way to tell a working link from a
                typo before saving. */}
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-line-2 bg-surface-2 text-ink-3">
              {previewable ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="size-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <ImageOff className="size-5" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <Input
                id="model-image"
                type="url"
                inputMode="url"
                placeholder="https://…"
                aria-invalid={errors.imageUrl ? true : undefined}
                aria-describedby={
                  errors.imageUrl ? "model-image-error" : "model-image-hint"
                }
                {...register("imageUrl")}
              />
              {errors.imageUrl ? (
                <FieldDescription
                  id="model-image-error"
                  role="alert"
                  className="mt-1.5 text-danger"
                >
                  {errors.imageUrl.message}
                </FieldDescription>
              ) : (
                <FieldDescription id="model-image-hint" className="mt-1.5">
                  Paste a link to a hosted image. Uploading from this screen
                  comes with file storage.
                </FieldDescription>
              )}
            </div>
          </div>
        </Field>

        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <StatusField
              value={field.value}
              onChange={field.onChange}
              description="Paused models stay out of new ticket entry."
              error={errors.status?.message}
              errorId="model-status-error"
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
          {isEdit ? "Save changes" : "Add model"}
        </Button>
      </DialogFooter>
    </form>
  );
}
