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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useCreateModel, useUpdateModel } from "@/hooks/useProductMaster";
import { useVendorOptions } from "@/hooks/useVendors";
import type { VendorOption } from "@/types/vendor";
import type {
  ProductCategory,
  ProductModel,
  ProductSubcategory,
  ServiceType,
} from "@/types/product";
import { StatusField } from "./StatusField";
import {
  MAX_MODEL_IMAGES,
  SERVICE_TYPES,
  SERVICE_TYPE_HINT,
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
      {/* Wider than it was: the photo strip is five 64px tiles plus an Add
          tile, which wrapped to a second row at the old 32rem and made a
          half-filled gallery look broken. */}
      <DialogContent className="sm:max-w-2xl">
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
      vendorId: model?.vendorId ?? "",
      // Installation + demo is what this product exists for, so it is the
      // starting point for a new model rather than an empty set.
      serviceTypes: model?.serviceTypes ?? ["Installation + Demo"],
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
      vendorId: values.vendorId,
      serviceTypes: values.serviceTypes,
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

      {/* `-mr-4 pr-4` cancels the dialog's own padding on this edge only, so
          the scrollbar rides the popup wall instead of floating in a gutter,
          while the fields keep their inset. */}
      <FieldGroup className="scroll-slim -mr-6 max-h-[62vh] gap-5 overflow-y-auto pr-6">
        {/* Name and brand together: they are the two required fields and the
            pair that identifies the unit — "Samsung 43-inch" is one thought,
            and splitting them across two rows hides that the brand is not
            optional detail like the two below. */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="model-name">Model name</FieldLabel>
            <Input
              id="model-name"
              placeholder={'e.g. 43" 4K UHD'}
              autoComplete="off"
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

          <Field data-invalid={errors.vendorId ? true : undefined}>
            <FieldLabel htmlFor="model-vendor">Brand</FieldLabel>
            <Controller
              name="vendorId"
              control={control}
              render={({ field }) => (
                <BrandSelect
                  value={field.value}
                  onChange={field.onChange}
                  invalid={errors.vendorId !== undefined}
                />
              )}
            />
            {errors.vendorId ? (
              <FieldDescription
                id="model-vendor-error"
                role="alert"
                className="text-danger"
              >
                {errors.vendorId.message}
              </FieldDescription>
            ) : (
              <FieldDescription id="model-vendor-hint">
                The vendor who makes it.
              </FieldDescription>
            )}
          </Field>
        </div>

        <FieldSeparator />

        <Controller
          name="serviceTypes"
          control={control}
          render={({ field }) => (
            <ServiceTypeField
              value={field.value}
              onChange={field.onChange}
              error={errors.serviceTypes?.message}
            />
          )}
        />

        <FieldSeparator />

        {/* Both optional, and side by side because they are read together —
            "43 inch, 24 months" is one thought about the unit. */}
        <FieldGroup className="grid gap-5 sm:grid-cols-2">
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

        <FieldSeparator />

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

        <FieldSeparator />

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

/**
 * What a technician can be sent to do with this model.
 *
 * Checkboxes rather than a dropdown: most models support more than one, and a
 * multi-select dropdown hides the choices behind a click when there are only
 * three of them. All three fit on screen, so show all three.
 *
 * "Select all" is a plain checkbox, not a tri-state one. An indeterminate box
 * would mean editing `ui/checkbox.tsx`, which is shadcn and not hand-edited —
 * and a half-filled square communicates through shape alone. The live count
 * beside the legend says "2 of 3 selected" in words instead, which is both
 * clearer and readable by a screen reader.
 */
function ServiceTypeField({
  value,
  onChange,
  error,
}: {
  value: ServiceType[];
  onChange: (next: ServiceType[]) => void;
  error?: string;
}) {
  const allSelected = value.length === SERVICE_TYPES.length;

  function toggle(type: ServiceType, checked: boolean) {
    // Rebuilt from SERVICE_TYPES rather than appended, so the order sent is
    // catalogue order however the boxes were clicked — matching what the API
    // stores, so a saved model never reorders under the user.
    const next = new Set(value);
    if (checked) next.add(type);
    else next.delete(type);
    onChange(SERVICE_TYPES.filter((t) => next.has(t)));
  }

  return (
    <FieldSet
      className="gap-3"
      data-invalid={error ? true : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? "model-service-error" : "model-service-hint"}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="grid gap-0.5">
          <FieldLegend variant="label" className="mb-0 text-ink">
            Service types
          </FieldLegend>
          <FieldDescription id="model-service-hint" className="mt-0">
            What a technician can be sent to do with this model.{" "}
            <span className="tabular-nums">
              {value.length} of {SERVICE_TYPES.length} selected
            </span>
            .
          </FieldDescription>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(next) =>
              onChange(next === true ? [...SERVICE_TYPES] : [])
            }
          />
          Select all
        </label>
      </div>

      <div className="grid gap-2">
        {SERVICE_TYPES.map((type) => {
          const checked = value.includes(type);
          return (
            <label
              key={type}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                checked
                  ? "border-brand-500 bg-brand-100/40"
                  : "border-line hover:border-brand-400"
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={checked}
                onCheckedChange={(next) => toggle(type, next === true)}
              />
              <span className="grid gap-0.5">
                <span className="text-[13px] font-medium">{type}</span>
                <span className="text-xs text-ink-2">
                  {SERVICE_TYPE_HINT[type]}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {error ? (
        <FieldDescription
          id="model-service-error"
          role="alert"
          className="text-danger"
        >
          {error}
        </FieldDescription>
      ) : null}
    </FieldSet>
  );
}

/**
 * The brand picker, driven by the active vendors.
 *
 * Its empty state matters more than usual: a brand is required, so a company
 * with no vendors yet cannot add a model at all. Saying that — and where to go
 * — beats an empty menu that reads as a broken control.
 */
function BrandSelect({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const { data, isPending, isError } = useVendorOptions();
  const vendors: VendorOption[] = data ?? [];
  const disabled = isPending || isError || vendors.length === 0;

  // Hard rule 10 — a single-option dropdown fills itself. Held off while the
  // list is still loading, or one arriving option would look like "the only one".
  useAutoSelectSingle(
    vendors.map((v) => v.id),
    value,
    onChange,
    !disabled
  );

  const selected = vendors.find((v) => v.id === value);

  const placeholder = isPending
    ? "Loading brands…"
    : isError
      ? "Couldn't load brands"
      : vendors.length === 0
        ? "No vendors yet — add one first"
        : "Select a brand";

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v ?? "")}
      disabled={disabled}
    >
      <SelectTrigger
        id="model-vendor"
        className="w-full"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? "model-vendor-error" : "model-vendor-hint"}
      >
        <SelectValue placeholder={placeholder}>
          {() => selected?.name ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {vendors.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
