import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, X } from "lucide-react";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { FormSection } from "@/components/shared/FormSection";
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
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { paiseToRupeeInput as toRupeeInput } from "@/utils/money";
import { useCreateModel, useUpdateModel } from "@/hooks/useProductMaster";
import { useVendorOptions } from "@/hooks/useVendors";
import type { VendorOption } from "@/types/vendor";
import type { ProductModel, ProductNode, ServiceType } from "@/types/product";
import { ParameterFields } from "./ParameterFields";
import { StatusField } from "./StatusField";
import {
  MAX_MODEL_IMAGES,
  SERVICE_TYPES,
  SERVICE_TYPE_HINT,
  cleanParameters,
  modelSchema,
  statusOf,
  type ModelFormValues,
} from "./categorySchema";

interface ModelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The catalogue node this product hangs off. Always at depth >= 1. */
  node: ProductNode;
  /** Omit to add. Pass a model to edit it in place. */
  model?: ProductModel;
}

export function ModelFormDialog({
  open,
  onOpenChange,
  node,
  model,
}: ModelFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than it was: the photo strip is five 64px tiles plus an Add
          tile, which wrapped to a second row at the old 32rem and made a
          half-filled gallery look broken. Sized with the other two-column form
          dialogs (Add user, Add technician) so the paired fields line up the
          same way across the console. */}
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <ModelForm
          node={node}
          model={model}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ModelForm({
  node,
  model,
  onDone,
}: {
  node: ProductNode;
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
      // Paise on the wire, rupees in the box. Blank on a new model rather than
      // a suggested figure: a price nobody chose is a price nobody checked.
      technicianPayoutPaise: toRupeeInput(model?.technicianPayoutPaise),
      vendorPricePaise: toRupeeInput(model?.vendorPricePaise),
      imageUrls: model?.imageUrls ?? [],
      notes: model?.notes ?? "",
      // A NEW product starts from the last sub-category's template — the field
      // names, plus whatever default it suggested. An EDIT shows what the
      // product itself saved: the template describes what a new one should ask,
      // not what an old one said.
      parameters:
        model?.parameters ??
        node.parameters.map((p) => ({ name: p.name, value: p.value })),
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
      // Rupees in the box, paise on the wire — hard rule 9, and the same
      // convention `tickets.bonusPaise` uses. (The Rules screen sends rupees
      // and converts server-side; that difference is deliberate and recorded
      // in `api/app/features/settings/schemas.py`.)
      technicianPayoutPaise: Number(values.technicianPayoutPaise) * 100,
      vendorPricePaise: Number(values.vendorPricePaise) * 100,
      imageUrls: values.imageUrls,
      // Same "blank means not recorded" rule as `capacity` directly above.
      notes: values.notes.trim() || null,
      parameters: cleanParameters(values.parameters),
      isActive: values.status === "Active",
    };
    const done = () => {
      toast.add({
        title: `${values.name} ${isEdit ? "updated" : "added"}`,
        description: `In ${node.path.join(" › ")}.`,
      });
      onDone();
    };

    if (isEdit) update.mutate({ id: model.id, ...body }, { onSuccess: done });
    else create.mutate({ nodeId: node.id, ...body }, { onSuccess: done });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Edit product model" : "Add product model"}
        </DialogTitle>
        <DialogDescription>
          In {node.path.join(" › ")}. Ticket intake picks a model from this list.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-5">
        {/* Name and brand together: they are the two required fields and the
            pair that identifies the unit — "Samsung 43-inch" is one thought,
            and splitting them across two rows hides that the brand is not
            optional detail like the two below. */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="model-name" required>
              Model name
            </FieldLabel>
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
            <FieldLabel htmlFor="model-vendor" required>
              Brand
            </FieldLabel>
            <Controller
              name="vendorId"
              control={control}
              render={({ field }) => (
                <BrandSelect
                  value={field.value}
                  onChange={field.onChange}
                  invalid={errors.vendorId !== undefined}
                  current={
                    model
                      ? { id: model.vendorId, name: model.vendorName }
                      : undefined
                  }
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
        <FieldGrid className="grid gap-5 sm:grid-cols-2">
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
        </FieldGrid>

        <FieldSeparator />

        {/* Side by side because they are the two halves of one decision — what
            this job is worth — and the margin between them is only legible
            when both are on screen at once.

            Neither party sees the other's figure. The vendor's intake form
            shows what it costs them; the technician's app shows what they
            earn. The server withholds each from the other, so this pair is the
            one place both numbers appear together. */}
        <FieldGrid className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors.technicianPayoutPaise ? true : undefined}>
            <FieldLabel htmlFor="model-payout">Paid to technician (₹)</FieldLabel>
            <Input
              id="model-payout"
              inputMode="numeric"
              placeholder="e.g. 450"
              aria-invalid={errors.technicianPayoutPaise ? true : undefined}
              aria-describedby={
                errors.technicianPayoutPaise
                  ? "model-payout-error"
                  : "model-payout-hint"
              }
              {...register("technicianPayoutPaise")}
            />
            {errors.technicianPayoutPaise ? (
              <FieldDescription
                id="model-payout-error"
                role="alert"
                className="text-danger"
              >
                {errors.technicianPayoutPaise.message}
              </FieldDescription>
            ) : (
              <FieldDescription id="model-payout-hint">
                Required. What a technician earns for one job on this model.
              </FieldDescription>
            )}
          </Field>

          <Field data-invalid={errors.vendorPricePaise ? true : undefined}>
            <FieldLabel htmlFor="model-price">Charged to vendor (₹)</FieldLabel>
            <Input
              id="model-price"
              inputMode="numeric"
              placeholder="e.g. 1200"
              aria-invalid={errors.vendorPricePaise ? true : undefined}
              aria-describedby={
                errors.vendorPricePaise
                  ? "model-price-error"
                  : "model-price-hint"
              }
              {...register("vendorPricePaise")}
            />
            {errors.vendorPricePaise ? (
              <FieldDescription
                id="model-price-error"
                role="alert"
                className="text-danger"
              >
                {errors.vendorPricePaise.message}
              </FieldDescription>
            ) : (
              <FieldDescription id="model-price-hint">
                Required. What the vendor pays to raise one of these tickets.
              </FieldDescription>
            )}
          </Field>
        </FieldGrid>

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

        <ParameterFields
          control={control}
          register={register}
          name="parameters"
          errors={errors}
          idPrefix="model"
          requireValue
          // Only when EDITING. A new product already opens from the whole
          // template, so there is never anything to offer — and offering
          // something the user has just deleted would be a nag.
          templateNames={
            model ? node.parameters.map((p) => p.name) : undefined
          }
          hint="Specs for this product — every field needs a value, because this is what the vendor and the technician will read."
        />

        <Field data-invalid={errors.notes ? true : undefined}>
          <FieldLabel htmlFor="model-notes">Notes (optional)</FieldLabel>
          <Textarea
            id="model-notes"
            rows={3}
            placeholder="e.g. Check the wall bracket rating before drilling."
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={
              errors.notes ? "model-notes-error" : "model-notes-hint"
            }
            {...register("notes")}
          />
          {errors.notes ? (
            <FieldDescription
              id="model-notes-error"
              role="alert"
              className="text-danger"
            >
              {errors.notes.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="model-notes-hint">
              Anything about this product that is not a spec — prose, so it has
              no field name to inherit under.
            </FieldDescription>
          )}
        </Field>

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
    <FormSection
      className="gap-3"
      data-invalid={error ? true : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? "model-service-error" : "model-service-hint"}
      legend="Service types"
      required
      hint={
        <FieldDescription id="model-service-hint" className="mt-0">
          What a technician can be sent to do with this model.{" "}
          <span className="tabular-nums">
            {value.length} of {SERVICE_TYPES.length} selected
          </span>
          .
        </FieldDescription>
      }
      action={
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(next) =>
              onChange(next === true ? [...SERVICE_TYPES] : [])
            }
          />
          Select all
        </label>
      }
    >

      {/* Three across on a wide dialog: the options are alternatives to weigh
          against each other, and a row compares them at a glance where a stack
          reads as a checklist. Grid, not flex, so the cards match height
          however unevenly the hints wrap. Stacked on narrow screens. */}
      <div className="grid gap-2 sm:grid-cols-3">
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
    </FormSection>
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
  current,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  /**
   * The brand this model already carries, if any. `/vendors/options` returns
   * only ACTIVE vendors, so without this a model branded with a paused vendor
   * would render as "Select a brand" — indistinguishable from a new model that
   * has none, and one careless save away from being silently re-branded.
   */
  current?: VendorOption;
}) {
  const { data, isPending, isError } = useVendorOptions();
  const active: VendorOption[] = data ?? [];
  // Kept selectable so re-saving the model does not force a brand change; the
  // API accepts the unchanged id even when the vendor is paused.
  const vendors =
    current && !active.some((v) => v.id === current.id)
      ? [current, ...active]
      : active;
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
