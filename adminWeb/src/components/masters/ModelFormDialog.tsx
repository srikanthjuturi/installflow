import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, X } from "lucide-react";
import { ImageCropDialog } from "@/components/shared/ImageCropDialog";
import {
  useImagePicker,
  type PickedImage,
} from "@/components/shared/useImagePicker";
import { uploadImage } from "@/services/uploads";
import { cn } from "@/lib/utils";
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
import {
  MAX_MODEL_IMAGES,
  modelSchema,
  statusOf,
  type ModelFormValues,
} from "./categorySchema";

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

  const [queue, setQueue] = useState<PickedImage[]>([]);

  const {
    control,
    register,
    setValue,
    getValues,
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
      imageUrls: model?.imageUrls ?? [],
      status: statusOf(model?.isActive ?? true),
    },
  });

  // Subscribes to just this field, and unlike `watch()` does not opt the whole
  // form out of the React Compiler.
  const imageUrls = useWatch({ control, name: "imageUrls" }) ?? [];
  const full = imageUrls.length >= MAX_MODEL_IMAGES;

  function setImages(next: string[]) {
    setValue("imageUrls", next, { shouldValidate: true, shouldDirty: true });
  }

  // Several at once: `max` is the room actually left, so five files dropped on
  // a model that already has three are refused with a reason rather than
  // silently truncated to two.
  const picker = useImagePicker({
    multiple: true,
    max: MAX_MODEL_IMAGES - imageUrls.length,
    onFiles: setQueue,
  });

  /**
   * Each crop is uploaded as soon as it is framed, not on submit: the field
   * holds URLs, so the previews below are the stored images themselves rather
   * than local copies. Abandoning the form leaves orphan blobs — a few KB under
   * a UUID nobody links to, which is the cheaper end of the trade.
   */
  async function handleCropped(blob: Blob) {
    const url = await uploadImage(blob, "product");
    // Read at call time, not from the closure: an upload takes seconds, and the
    // list it appends to must be the one on screen when it lands.
    setImages([...getValues("imageUrls"), url]);
  }

  function submit(values: ModelFormValues) {
    const body = {
      name: values.name,
      // An empty box means "not recorded", which the API stores as null —
      // never an empty string, so "unknown" and "blank" cannot diverge.
      capacity: values.capacity.trim() || null,
      warrantyMonths: values.warrantyMonths.trim()
        ? Number(values.warrantyMonths)
        : null,
      imageUrls: values.imageUrls,
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

        <Field data-invalid={errors.imageUrls ? true : undefined}>
          <FieldLabel htmlFor="model-image">
            Photos (optional) · {imageUrls.length}/{MAX_MODEL_IMAGES}
          </FieldLabel>

          <input {...picker.inputProps} />

          {/* The whole strip takes a drop, not just the Add tile — a dragged
              photo is aimed at "the photos", and asking for a 64px target is
              asking to miss. */}
          <div
            {...picker.dropProps}
            className={cn(
              "flex flex-wrap items-start gap-2 rounded-md ring-offset-2 ring-offset-card transition-shadow",
              picker.dragging && "ring-2 ring-brand-500"
            )}
          >
            {imageUrls.map((url, index) => (
              <span
                key={url}
                className="group relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-line-2 bg-surface-2 text-ink-3"
              >
                <img
                  src={url}
                  alt=""
                  className="size-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                {/* The first photo is the one every list draws, so it is worth
                    saying which one that is rather than leaving order implicit. */}
                {index === 0 ? (
                  <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[10px] font-medium text-white">
                    Main
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  onClick={() =>
                    setImages(imageUrls.filter((_, i) => i !== index))
                  }
                  aria-label={`Remove photo ${index + 1}`}
                  className="absolute -top-1 -right-1 rounded-full ring-2 ring-card"
                >
                  <X />
                </Button>
              </span>
            ))}

            {/* Kept mounted when full, and disabled: the label points at it,
                and a tile that greys out reads as "that is the limit" where a
                vanished one reads as a bug. */}
            <button
              id="model-image"
              type="button"
              onClick={picker.open}
              disabled={full}
              title={full ? `Up to ${MAX_MODEL_IMAGES} photos` : undefined}
              aria-describedby={
                errors.imageUrls ? "model-image-error" : "model-image-hint"
              }
              className="grid size-16 shrink-0 place-items-center gap-0.5 rounded-md border border-dashed border-line bg-surface-2 text-ink-3 transition-colors hover:border-brand-400 hover:text-brand-400 disabled:pointer-events-none disabled:opacity-50"
            >
              <ImagePlus className="size-5" aria-hidden />
              <span className="text-[10px] font-medium">
                {imageUrls.length ? "Add" : "Upload"}
              </span>
            </button>
          </div>

          {picker.error ? (
            <FieldDescription role="alert" className="text-danger">
              {picker.error}
            </FieldDescription>
          ) : errors.imageUrls ? (
            <FieldDescription
              id="model-image-error"
              role="alert"
              className="text-danger"
            >
              {errors.imageUrls.message ??
                errors.imageUrls.root?.message ??
                `Up to ${MAX_MODEL_IMAGES} photos per model`}
            </FieldDescription>
          ) : (
            <FieldDescription id="model-image-hint">
              Drop images here or click to browse — several at once. PNG, JPG or
              WebP, up to {MAX_MODEL_IMAGES}. Each is cropped to a square; the
              first is the one ticket intake shows.
            </FieldDescription>
          )}
        </Field>

        <ImageCropDialog
          images={queue}
          onClose={() => {
            setQueue([]);
            picker.release();
          }}
          title="Product photo"
          description="drag to reposition and zoom to frame the product."
          saveLabel="Add photo"
          onSave={handleCropped}
        />

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
