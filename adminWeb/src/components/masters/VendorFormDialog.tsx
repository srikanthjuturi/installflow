import { Controller, useForm, useWatch } from "react-hook-form";
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
  FieldLegend,
  FieldSet,
  FieldTitle,
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
import { toast } from "@/components/ui/toast";
import { useCreateVendor, useUpdateVendor } from "@/hooks/useMasters";
import { cn } from "@/lib/utils";
import {
  CHANNEL_HINT,
  INTAKE_CHANNELS,
  VENDOR_STATUSES,
  vendorSchema,
  type VendorFormValues,
} from "./vendorSchema";
import type { Vendor } from "@/types";

interface VendorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → manage that vendor. Absent → onboard a new one. */
  vendor?: Vendor;
}

/**
 * One dialog for both jobs. Onboarding needs a name; managing does not, since
 * the name is identity and the rest of the record — lifetime tickets, the
 * year onboarded, the API key — is either derived or issued server-side.
 */
export function VendorFormDialog({
  open,
  onOpenChange,
  vendor,
}: VendorFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* The popup unmounts on close, so the form starts clean every time it
            opens; the key covers reopening on a different row. */}
        <VendorForm
          key={vendor?.id ?? "new"}
          vendor={vendor}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function VendorForm({
  vendor,
  onDone,
}: {
  vendor?: Vendor;
  onDone: () => void;
}) {
  const create = useCreateVendor();
  const update = useUpdateVendor();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: vendor?.name ?? "",
      // Most vendors have no CRM, so the common case is the default.
      channel: vendor?.channel ?? "Excel",
      status: vendor?.status ?? "Active",
    },
  });

  // Only this field drives conditional markup, so only this field is watched.
  const channel = useWatch({ control, name: "channel" });

  const isSubmitting = create.isPending || update.isPending;
  const err = (name: keyof VendorFormValues) => errors[name]?.message;

  function submit(values: VendorFormValues) {
    if (vendor) {
      update.mutate(
        { id: vendor.id, channel: values.channel, status: values.status },
        {
          onSuccess: (saved) => {
            toast.add({
              title: `${saved.name} updated`,
              description: `Intake ${saved.channel} · ${saved.status}.`,
            });
            onDone();
          },
        }
      );
      return;
    }

    create.mutate(values, {
      onSuccess: (saved) => {
        toast.add({
          title: `${saved.name} added`,
          description:
            saved.channel === "API"
              ? "API key issued. It is stored masked and never shown in full."
              : `Intake channel: ${saved.channel}.`,
        });
        onDone();
      },
    });
  }

  // Credentials exist for the API channel and nowhere else. Nothing below is
  // an input — the console never captures or displays a full key.
  const keepsKey = vendor?.channel === "API" && vendor.key !== "—";
  const losesKey = vendor?.channel === "API" && channel !== "API";

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {vendor ? `Manage ${vendor.name}` : "Add vendor"}
        </DialogTitle>
        <DialogDescription>
          {vendor
            ? "Change how tickets arrive, or pause new ones."
            : "Onboard a vendor and set how its tickets arrive."}
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={err("name") ? true : undefined}>
          <FieldLabel htmlFor="vendor-name">Vendor name</FieldLabel>
          <Input
            id="vendor-name"
            placeholder="Company name"
            autoComplete="organization"
            disabled={Boolean(vendor)}
            aria-invalid={err("name") ? true : undefined}
            aria-describedby={err("name") ? "vendor-name-error" : undefined}
            {...register("name")}
          />
          {vendor ? (
            <FieldDescription>
              The name can&apos;t be changed here.
            </FieldDescription>
          ) : null}
          {err("name") ? (
            <FieldDescription
              id="vendor-name-error"
              role="alert"
              className="text-danger"
            >
              {err("name")}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={err("channel") ? true : undefined}>
          <FieldLabel htmlFor="vendor-channel">Intake channel</FieldLabel>
          <Controller
            name="channel"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="vendor-channel"
                  className="w-full"
                  aria-invalid={err("channel") ? true : undefined}
                  aria-describedby={
                    err("channel") ? "vendor-channel-error" : undefined
                  }
                >
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {INTAKE_CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>{CHANNEL_HINT[channel]}</FieldDescription>
          {losesKey ? (
            <FieldDescription className="text-warn">
              Leaving API revokes this vendor&apos;s key on save.
            </FieldDescription>
          ) : null}
          {err("channel") ? (
            <FieldDescription
              id="vendor-channel-error"
              role="alert"
              className="text-danger"
            >
              {err("channel")}
            </FieldDescription>
          ) : null}
        </Field>

        {channel === "API" ? (
          <Field>
            <FieldTitle>API credentials</FieldTitle>
            <p className="font-mono text-xs text-ink-2">
              {keepsKey ? vendor.key : "Issued on save"}
            </p>
            <FieldDescription>
              Keys are issued by the platform and stored masked. The console
              never shows or accepts a full key.
            </FieldDescription>
          </Field>
        ) : null}

        {/* A radiogroup has no labelable control, so it gets a legend and its
            own accessible name rather than a <label for>. */}
        <FieldSet data-invalid={err("status") ? true : undefined}>
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
                aria-invalid={err("status") ? true : undefined}
                aria-describedby={
                  err("status") ? "vendor-status-error" : undefined
                }
                className="grid grid-cols-2 gap-2.5"
              >
                {VENDOR_STATUSES.map((s) => (
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
            Paused vendors stop sending new tickets.
          </FieldDescription>
          {err("status") ? (
            <FieldDescription
              id="vendor-status-error"
              role="alert"
              className="text-danger"
            >
              {err("status")}
            </FieldDescription>
          ) : null}
        </FieldSet>
      </FieldGroup>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {vendor ? "Save changes" : "Add vendor"}
        </Button>
      </DialogFooter>
    </form>
  );
}
