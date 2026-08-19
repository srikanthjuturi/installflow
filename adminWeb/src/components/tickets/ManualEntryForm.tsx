import { useEffect, useMemo } from "react";
import { FormSection } from "@/components/shared/FormSection";
import { Link } from "react-router";
import type { Control } from "react-hook-form";
import { Controller, useController, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useCategoryTree } from "@/hooks/useProductMaster";
import { cn } from "@/lib/utils";
import { istToday, offeredSlots, type OfferedSlot } from "@/utils/slots";
import type { VendorOption } from "@/types/vendor";
import type { CreateTicketInput } from "@/types/ticket";
import {
  SERVICE_LEVEL_OPTIONS,
  ticketSchema,
  type TicketFormValues,
} from "./ticketSchema";

/** `{ value, label }` because the selects now store ids and show names. */
interface Option {
  value: string;
  label: string;
}

interface OptionGroup {
  /** A parent category — rendered as the dropdown's group heading. */
  label?: string;
  options: Option[];
}

interface ManualEntryFormProps {
  onSubmit: (values: CreateTicketInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  /**
   * The brand this ticket is raised against, already known.
   *
   * REQUIRED, because the only caller is the vendor portal — a vendor does not
   * choose which vendor it is. Passing it replaces the vendor select with a
   * read-only field and skips `useVendorOptions()` entirely: that endpoint is
   * gated on `masters.view` and, for a staff caller, lists every brand in the
   * company. A vendor must neither need it nor see its result.
   */
  vendor: VendorOption;
}

export function ManualEntryForm({
  onSubmit,
  onCancel,
  isSubmitting,
  vendor,
}: ManualEntryFormProps) {

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      vendorId: vendor.id,
      subcategoryId: "",
      modelId: "",
      serviceType: "Installation + Demo",
      description: "",
      serialNumber: "",
      customerName: "",
      customerPhone: "",
      address: "",
      city: "",
      state: "",
      pincode: "",
      expectedDate: "",
      serviceLevelHours: 24,
      slotStart: "",
      slotEnd: "",
    },
  });

  // Models belong to a subcategory, so the second select depends on the first.
  // useWatch subscribes to just this field — watch() re-renders on every
  // keystroke anywhere in the form and isn't memoization-safe.
  const vendorId = useWatch({ control, name: "vendorId" });
  const subcategoryId = useWatch({ control, name: "subcategoryId" });
  const modelId = useWatch({ control, name: "modelId" });
  const serviceType = useWatch({ control, name: "serviceType" });
  const slotStart = useWatch({ control, name: "slotStart" });
  // The windows on offer depend on it, so the picker has to redraw when the
  // service level changes — a 12h ticket has far fewer than a 48h one.
  const serviceLevelHours = useWatch({ control, name: "serviceLevelHours" });

  /* The whole picker is a cascade, and the vendor is the top of it: a ticket is
     raised against a specific brand's product, so the categories on offer are
     the ones that vendor actually makes something in. Narrowing on the server
     rather than filtering here means the empty case is a fact the API states,
     not something the form has to infer from an empty array. */
  const { data: tree, isPending: treePending } = useCategoryTree(
    false,
    vendorId
  );
  const vendorName = vendor.name;
  // A vendor with nothing to install is a gap in the master, not a dead end for
  // the person keying in a ticket — so it is named, with somewhere to go.
  const vendorHasNothing =
    Boolean(vendorId) && !treePending && (tree ?? []).length === 0;

  /* The master is three levels deep but the approved form has one Category
     field, so the parent becomes the dropdown's group heading rather than a
     fifth control. A technician is certified for subcategories, so this is
     also the level the ticket has to record. */
  const categoryGroups: OptionGroup[] = (tree ?? []).map((category) => ({
    label: category.name,
    options: category.subcategories.map((s) => ({
      value: s.id,
      label: s.name,
    })),
  }));

  const subcategory = (tree ?? [])
    .flatMap((c) => c.subcategories)
    .find((s) => s.id === subcategoryId);

  const modelGroups: OptionGroup[] = [
    {
      options: (subcategory?.models ?? []).map((m) => ({
        value: m.id,
        label: m.name,
      })),
    },
  ];

  /* The service types on offer are the ones the CHOSEN MODEL declares it
     supports — a microwave that only does installation must not be raised as a
     Tech Visit. The server enforces the same rule; this stops the user finding
     out after they submit. */
  const model = subcategory?.models.find((m) => m.id === modelId);
  const serviceTypeGroups: OptionGroup[] = [
    { options: (model?.serviceTypes ?? []).map((t) => ({ value: t, label: t })) },
  ];

  // Only these two carry a fault to describe. An installation explains itself.
  const needsProblem = serviceType === "Tech Visit" || serviceType === "Service";

  const err = (name: keyof TicketFormValues) => errors[name]?.message;

  function submit(values: TicketFormValues) {
    onSubmit({
      vendorId: values.vendorId,
      subcategoryId: values.subcategoryId,
      modelId: values.modelId,
      serviceType: values.serviceType,
      // Empty means "not recorded", which the API stores as null — never an
      // empty string, so "unknown" and "blank" cannot diverge.
      description: values.description.trim() || null,
      serialNumber: values.serialNumber.trim(),
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      address: values.address,
      city: values.city,
      state: values.state,
      pincode: values.pincode,
      expectedDate: values.expectedDate,
      serviceLevelHours: values.serviceLevelHours,
      // Already ISO instants — the picker stores the window it offered, so
      // there is no wall-clock string to reinterpret in some other zone.
      slotStart: values.slotStart || null,
      slotEnd: values.slotEnd || null,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <Card>
        <CardContent className="flex flex-col gap-6">
          <FormSection legend={<>Vendor &amp; product</>}>
            <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {/* Read-only rather than a one-option select: there is nothing
                  to choose, and a disabled dropdown invites a click that does
                  nothing. Same treatment `ScopeField` gives a National Head's
                  "All India". The value is still submitted and still validated
                  — and the server independently refuses any vendor that is not
                  the caller's own. */}
              <Field>
                <FieldLabel htmlFor="vendor-name">Company / vendor</FieldLabel>
                <Input id="vendor-name" value={vendor.name} readOnly disabled />
              </Field>
              <SelectField
                name="subcategoryId"
                label="Category"
                placeholder={
                  !vendorId
                    ? "Pick a vendor first"
                    : vendorHasNothing
                      ? `${vendorName} has no product models yet`
                      : "Select category"
                }
                groups={categoryGroups}
                disabled={!vendorId || vendorHasNothing}
                control={control}
                error={err("subcategoryId")}
                onChanged={() => {
                  // Both depend on the category: a model from the old one, and
                  // a service type the new model may not even support.
                  setValue("modelId", "", { shouldValidate: false });
                  setValue("serviceType", "Installation + Demo", {
                    shouldValidate: false,
                  });
                }}
              />
              <SelectField
                name="modelId"
                label="Product model"
                placeholder={
                  subcategoryId ? "Select model" : "Pick a category first"
                }
                groups={modelGroups}
                disabled={!subcategoryId}
                control={control}
                error={err("modelId")}
                onChanged={() =>
                  setValue("serviceType", "Installation + Demo", {
                    shouldValidate: false,
                  })
                }
              />
              <SelectField
                name="serviceType"
                label="Service type"
                placeholder={modelId ? "Select type" : "Pick a model first"}
                groups={serviceTypeGroups}
                disabled={!modelId}
                control={control}
                error={err("serviceType")}
              />
            </FieldGroup>

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {/* Only the two service types that describe a fault. Rendering it
                  always would invite a description the API then refuses. */}
              {needsProblem ? (
                <TextField
                  name="description"
                  label="What is the problem?"
                  placeholder="e.g. Cooling has dropped and the outdoor unit rattles"
                  register={register}
                  error={err("description")}
                />
              ) : null}
              <TextField
                name="serialNumber"
                label="Serial number"
                placeholder="As printed on the box"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                register={register}
                error={err("serialNumber")}
              />
            </FieldGroup>
            {/* Said once, here, because "which serial?" is the obvious question
                and the answer decides whether AI review can do its job. */}
            <FieldDescription>
              The serial you EXPECT to find, off the invoice — the technician
              photographs the real one on site, and a mismatch is what AI review
              catches.
            </FieldDescription>
          </FormSection>

          {/* A dead end with a way out of it: an empty dropdown reads as broken,
              this reads as a task and links to where it is done.

              Card level, NOT inside the FieldSet above. A bare <p> among Fields
              is caught by the field CSS — `*:w-full` and the grid's stretch
              between them collapsed the whole select row to zero height, which
              looked exactly like the four dropdowns had vanished. The info
              banner at the foot of this form sits here for the same reason. */}
          {vendorHasNothing ? (
            <p className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
              <Info className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                {vendorName} has no product models yet, so there is nothing to
                raise a ticket against.{" "}
                <Link
                  to="/categories"
                  className="font-semibold underline underline-offset-2"
                >
                  Add one in Product Master
                </Link>
                , or pick a different vendor.
              </span>
            </p>
          ) : null}

          <FormSection legend="Customer">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="customerName"
                label="Customer name"
                placeholder="Full name"
                autoComplete="name"
                register={register}
                error={err("customerName")}
              />
              <TextField
                name="customerPhone"
                label="Mobile number"
                placeholder="+91 "
                inputMode="tel"
                autoComplete="tel"
                register={register}
                error={err("customerPhone")}
              />
            </FieldGroup>

            {/* The address is new. Without it the technician has a pincode and
                a name, which is enough to be dispatched and not enough to
                arrive. */}
            <FieldGroup className="grid gap-4">
              <TextField
                name="address"
                label="Address"
                placeholder="Flat / building, street, area"
                autoComplete="address-line1"
                register={register}
                error={err("address")}
              />
            </FieldGroup>

            <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <TextField
                name="city"
                label="City"
                placeholder="Pune"
                autoComplete="address-level2"
                register={register}
                error={err("city")}
              />
              <TextField
                name="state"
                label="State"
                placeholder="Maharashtra"
                autoComplete="address-level1"
                register={register}
                error={err("state")}
              />
              <TextField
                name="pincode"
                label="Pincode"
                placeholder="6-digit"
                inputMode="numeric"
                maxLength={6}
                register={register}
                error={err("pincode")}
              />
              <TextField
                name="expectedDate"
                label="Expected date"
                type="date"
                // The picker itself refuses a past day, so the common mistake
                // never reaches validation. The schema and the API still check
                // it — a typed date ignores `min`.
                min={istToday()}
                register={register}
                error={err("expectedDate")}
              />
            </FieldGroup>
          </FormSection>

          <FormSection legend="Service level">
            <Controller
              name="serviceLevelHours"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                >
                  {SERVICE_LEVEL_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3 transition-colors",
                        field.value === o.value
                          ? "border-brand-500 bg-brand-100/40"
                          : "border-line hover:border-brand-400"
                      )}
                    >
                      <RadioGroupItem value={String(o.value)} />
                      <span>
                        <span className="block text-[13px] font-semibold">
                          {o.title}
                        </span>
                        <span className="block text-xs text-ink-3">
                          {o.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            />
          </FormSection>

          <FormSection legend="Slot (optional)">
            <SlotPicker
              control={control}
              serviceLevelHours={serviceLevelHours}
              error={err("slotStart")}
            />
            <FieldDescription>
              Fill this in if you already agreed a time on the call. Leave it
              blank and the customer is asked to pick one.
            </FieldDescription>
          </FormSection>

          {/* The single most misunderstood rule in the flow, stated on the
              screen where someone could get it wrong — and now stated to match
              what was actually entered, rather than always promising a request. */}
          <p className="flex items-start gap-2.5 rounded-md bg-info-bg px-3.5 py-3 text-xs leading-relaxed text-info">
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            {slotStart ? (
              <>
                The slot is locked to the ticket and it goes straight to
                eligible technicians. A technician accepts that fixed time — they
                never propose one.
              </>
            ) : (
              <>
                With no slot the ticket waits as <b>Slot Pending</b>. No
                technician is told it exists until a time is confirmed.
              </>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {/* Follows the slot, like the banner above: with a time already
              agreed there is no request to send. */}
          {slotStart ? "Create ticket" : "Create ticket & request slot"}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Field wrappers — validation state is wired identically for every input:
   data-invalid on the Field, aria-invalid on the control, and the message
   in a role="alert" the control points at.
   ---------------------------------------------------------------------- */

/**
 * The slot, chosen from the windows a customer could have picked.
 *
 * A menu rather than two `datetime-local` boxes, and that is the whole fix: the
 * free inputs accepted any instant at all, so a vendor could type 19:03–21:05
 * on a 12-hour ticket and the ticket was born Breached, outside working hours,
 * in a window no technician's day has. The API refuses that now
 * (`check_slot_bookable`); offering only real windows means nobody has to be
 * refused to find out.
 *
 * Grouped by day, because "which day" and "what time" are how somebody who just
 * agreed a slot on the phone actually holds it.
 */
function SlotPicker({
  control,
  serviceLevelHours,
  error,
}: {
  control: Control<TicketFormValues>;
  serviceLevelHours: number;
  error?: string;
}) {
  const { field: start } = useController({ control, name: "slotStart" });
  const { field: end } = useController({ control, name: "slotEnd" });

  // Recomputed when the service level changes — shortening it can strand a
  // window that was on offer a moment ago.
  const slots = useMemo(
    () => offeredSlots(serviceLevelHours),
    [serviceLevelHours]
  );

  const days = useMemo(() => {
    const byDay = new Map<string, OfferedSlot[]>();
    for (const s of slots) {
      const list = byDay.get(s.day);
      if (list) list.push(s);
      else byDay.set(s.day, [s]);
    }
    return [...byDay.entries()];
  }, [slots]);

  const chosen = start.value;
  const stillOffered = slots.some((s) => s.start === chosen);

  // Dropping to a shorter service level can put the chosen window past the new
  // deadline. Clearing it is the honest outcome — the alternative is a trigger
  // rendering blank over a value that is still in the form and would be
  // refused on submit.
  useEffect(() => {
    if (chosen && !stillOffered) {
      start.onChange("");
      end.onChange("");
    }
  }, [chosen, stillOffered, start, end]);

  const id = "field-slot";

  if (slots.length === 0) {
    return (
      <p className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
        <Info className="mt-px size-4 shrink-0" aria-hidden />
        <span>
          A {serviceLevelHours}h service level leaves no bookable window — every
          one of them is already past the deadline. Choose a longer service
          level, or leave this blank and the customer will be asked to pick.
        </span>
      </p>
    );
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>Agreed window</FieldLabel>
      <Select
        value={chosen}
        onValueChange={(next) => {
          const slot = slots.find((s) => s.start === next);
          start.onChange(slot?.start ?? "");
          end.onChange(slot?.end ?? "");
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full sm:max-w-100"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder="Leave blank and ask the customer" />
        </SelectTrigger>
        <SelectContent>
          {days.map(([day, windows]) => (
            <SelectGroup key={day}>
              <SelectLabel>{day}</SelectLabel>
              {windows.map((s) => (
                <SelectItem key={s.start} value={s.start}>
                  {s.time}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : (
        <FieldDescription>
          Two-hour windows inside the {serviceLevelHours}h service level. The
          same ones the customer is offered.
        </FieldDescription>
      )}
    </Field>
  );
}

function TextField({
  name,
  label,
  error,
  register,
  ...input
}: {
  name: keyof TicketFormValues;
  label: string;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
} & React.ComponentProps<typeof Input>) {
  const id = `field-${name}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...register(name)}
        {...input}
      />
      {error ? (
        <FieldDescription
          id={`${id}-error`}
          role="alert"
          className="text-danger"
        >
          {error}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

function SelectField({
  name,
  label,
  placeholder,
  groups,
  control,
  error,
  disabled,
  onChanged,
}: {
  name: keyof TicketFormValues;
  label: string;
  placeholder: string;
  groups: OptionGroup[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  error?: string;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const id = `field-${name}`;
  const { field } = useController({ name, control });

  const options = groups.flatMap((g) => g.options);

  const select = (v: string) => {
    field.onChange(v);
    onChanged?.();
  };

  // A dropdown with a single choice fills itself — but not while it's disabled
  // (the model select before a category is picked) or its list is empty. The
  // values are what the control stores, so ids here, not labels.
  useAutoSelectSingle(
    options.map((o) => o.value),
    field.value,
    select,
    !disabled
  );

  // The trigger holds the id, so the label has to be looked up to display it.
  const selected = options.find((o) => o.value === field.value);

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={field.value} onValueChange={select} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder={placeholder}>
            {() => selected?.label ?? placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {groups.map((group, i) => (
            <SelectGroup key={group.label ?? i}>
              {group.label ? (
                <SelectLabel>{group.label}</SelectLabel>
              ) : null}
              {group.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldDescription
          id={`${id}-error`}
          role="alert"
          className="text-danger"
        >
          {error}
        </FieldDescription>
      ) : null}
    </Field>
  );
}
