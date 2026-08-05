import { Controller, useForm, useWatch } from "react-hook-form";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CATEGORIES, REQUEST_TYPES, VENDORS } from "@/services/mocks/masters";
import { SLA_OPTIONS, ticketSchema, type TicketFormValues } from "./ticketSchema";

interface ManualEntryFormProps {
  onSubmit: (values: TicketFormValues) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function ManualEntryForm({ onSubmit, onCancel, isSubmitting }: ManualEntryFormProps) {
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
      category: "",
      product: "",
      requestType: "Installation",
      customer: "",
      mobile: "",
      pincode: "",
      expected: "",
      slaType: "24h",
    },
  });

  // Models belong to a category, so the second select depends on the first.
  // useWatch subscribes to just this field — watch() re-renders on every
  // keystroke anywhere in the form and isn't memoization-safe.
  const category = useWatch({ control, name: "category" });
  const models = CATEGORIES.find((c) => c.name === category)?.models ?? [];

  const err = (name: keyof TicketFormValues) => errors[name]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardContent className="flex flex-col gap-6">
          <FieldSet>
            <FieldLegend className="text-sm font-semibold">Vendor &amp; product</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SelectField
                name="vendor"
                label="Company / vendor"
                placeholder="Select vendor"
                options={VENDORS.filter((v) => v.status === "Active").map((v) => v.name)}
                control={control}
                error={err("vendor")}
              />
              <SelectField
                name="category"
                label="Category"
                placeholder="Select category"
                options={CATEGORIES.map((c) => c.name)}
                control={control}
                error={err("category")}
                onChanged={() => setValue("product", "", { shouldValidate: false })}
              />
              <SelectField
                name="product"
                label="Product model"
                placeholder={category ? "Select model" : "Pick a category first"}
                options={models}
                disabled={!category}
                control={control}
                error={err("product")}
              />
              <SelectField
                name="requestType"
                label="Request type"
                placeholder="Select type"
                options={[...REQUEST_TYPES]}
                control={control}
                error={err("requestType")}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend className="text-sm font-semibold">Customer</FieldLegend>
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
            <FieldLegend className="text-sm font-semibold">Service level</FieldLegend>
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
                          : "border-line hover:border-brand-400",
                      )}
                    >
                      <RadioGroupItem value={o.value} />
                      <span>
                        <span className="block text-[13px] font-semibold">{o.title}</span>
                        <span className="text-ink-3 block text-xs">{o.detail}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            />
          </FieldSet>

          {/* The single most misunderstood rule in the flow, stated on the
              screen where someone could get it wrong. */}
          <p className="bg-info-bg text-info flex items-start gap-2.5 rounded-md px-3.5 py-3 text-xs leading-relaxed">
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            On submit, a WhatsApp/SMS slot request is sent to the customer. The technician is
            notified only after the customer confirms a slot.
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
        <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
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
  options,
  control,
  error,
  disabled,
  onChanged,
}: {
  name: keyof TicketFormValues;
  label: string;
  placeholder: string;
  options: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  error?: string;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const id = `field-${name}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select
            value={field.value}
            onValueChange={(v) => {
              field.onChange(v);
              onChanged?.();
            }}
            disabled={disabled}
          >
            <SelectTrigger
              id={id}
              className="w-full"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
      {error ? (
        <FieldDescription id={`${id}-error`} role="alert" className="text-danger">
          {error}
        </FieldDescription>
      ) : null}
    </Field>
  );
}
