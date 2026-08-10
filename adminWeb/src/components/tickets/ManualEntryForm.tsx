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
  FieldLegend,
  FieldSet,
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
import { REQUEST_TYPES, VENDORS } from "@/services/mocks/masters";
import {
  SLA_OPTIONS,
  ticketSchema,
  type TicketFormValues,
  type TicketSubmitValues,
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

const plain = (values: readonly string[]): OptionGroup[] => [
  { options: values.map((v) => ({ value: v, label: v })) },
];

interface ManualEntryFormProps {
  onSubmit: (values: TicketSubmitValues) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function ManualEntryForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: ManualEntryFormProps) {
  const { data: tree } = useCategoryTree();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      vendor: "",
      subcategoryId: "",
      modelId: "",
      requestType: "Installation",
      customer: "",
      mobile: "",
      pincode: "",
      expected: "",
      slaType: "24h",
    },
  });

  // Models belong to a subcategory, so the second select depends on the first.
  // useWatch subscribes to just this field — watch() re-renders on every
  // keystroke anywhere in the form and isn't memoization-safe.
  const subcategoryId = useWatch({ control, name: "subcategoryId" });

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

  const err = (name: keyof TicketFormValues) => errors[name]?.message;

  /* Ids are what the selects hold; names are what a ticket records. Resolving
     here keeps the page a pass-through and leaves the ids available for when
     ticket intake binds to the API. */
  function submit(values: TicketFormValues) {
    const model = subcategory?.models.find((m) => m.id === values.modelId);
    const { subcategoryId: subId, modelId, ...rest } = values;
    onSubmit({
      ...rest,
      subcategoryId: subId,
      modelId,
      category: subcategory?.name ?? "",
      product: model?.name ?? "",
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <Card>
        <CardContent className="flex flex-col gap-6">
          <FieldSet>
            <FieldLegend className="text-sm font-semibold">
              Vendor &amp; product
            </FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SelectField
                name="vendor"
                label="Company / vendor"
                placeholder="Select vendor"
                groups={plain(
                  VENDORS.filter((v) => v.status === "Active").map((v) => v.name)
                )}
                control={control}
                error={err("vendor")}
              />
              <SelectField
                name="subcategoryId"
                label="Category"
                placeholder="Select category"
                groups={categoryGroups}
                control={control}
                error={err("subcategoryId")}
                onChanged={() =>
                  setValue("modelId", "", { shouldValidate: false })
                }
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
              />
              <SelectField
                name="requestType"
                label="Request type"
                placeholder="Select type"
                groups={plain([...REQUEST_TYPES])}
                control={control}
                error={err("requestType")}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend className="text-sm font-semibold">
              Customer
            </FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <TextField
                name="customer"
                label="Customer name"
                placeholder="Full name"
                autoComplete="name"
                register={register}
                error={err("customer")}
              />
              <TextField
                name="mobile"
                label="Mobile number"
                placeholder="+91 "
                inputMode="tel"
                autoComplete="tel"
                register={register}
                error={err("mobile")}
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
                name="expected"
                label="Expected date"
                type="date"
                register={register}
                error={err("expected")}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend className="text-sm font-semibold">
              Service level
            </FieldLegend>
            <Controller
              name="slaType"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {SLA_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3 transition-colors",
                        field.value === o.value
                          ? "border-brand-500 bg-brand-100/40"
                          : "border-line hover:border-brand-400"
                      )}
                    >
                      <RadioGroupItem value={o.value} />
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
          </FieldSet>

          {/* The single most misunderstood rule in the flow, stated on the
              screen where someone could get it wrong. */}
          <p className="flex items-start gap-2.5 rounded-md bg-info-bg px-3.5 py-3 text-xs leading-relaxed text-info">
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            On submit, a WhatsApp/SMS slot request is sent to the customer. The
            technician is notified only after the customer confirms a slot.
          </p>
        </CardContent>
      </Card>

      <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Create ticket &amp; request slot
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
