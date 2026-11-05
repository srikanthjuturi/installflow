import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useCreateApiCredential } from "@/hooks/useApiCredentials";
import { useVendorOptions } from "@/hooks/useVendors";
import type { CreatedApiCredential } from "@/types/integration";

const schema = z.object({
  vendorId: z.string().min(1, "Pick the vendor this credential is for"),
  note: z.string().trim().max(120, "Keep the label under 120 characters"),
});

type Values = z.infer<typeof schema>;

/**
 * Issue a credential for ONE vendor.
 *
 * The picker offers only vendors that have the API channel ticked — the server
 * refuses any other (409 `API_CHANNEL_OFF`), so offering them would be a dead
 * end. When there are none the dialog says where to switch the channel on
 * instead of showing an empty list.
 *
 * It does not show the secret itself: it hands the response to `onCreated`, and
 * the page opens `CredentialSecretDialog`, so the one place a secret is drawn is
 * the one place that warns it will not be shown again.
 */
export function GenerateCredentialDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedApiCredential) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Unmounts on close, so the form is fresh on every open. */}
        {open ? (
          <GenerateForm
            onDone={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function GenerateForm({
  onDone,
  onCreated,
}: {
  onDone: () => void;
  onCreated: (created: CreatedApiCredential) => void;
}) {
  const create = useCreateApiCredential();
  const vendors = useVendorOptions();
  const eligible = (vendors.data ?? []).filter((v) =>
    (v.intakeChannels ?? []).includes("API")
  );
  const none = !vendors.isLoading && !vendors.isError && eligible.length === 0;

  const {
    control,
    register,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { vendorId: "", note: "" },
  });

  // Hard rule 10 — a single-option dropdown fills itself. Held off while the
  // list is loading, or one arriving option would look like "the only one".
  const vendorId = useWatch({ control, name: "vendorId" }) ?? "";
  useAutoSelectSingle(
    eligible.map((v) => v.id),
    vendorId,
    (next) => setValue("vendorId", next, { shouldValidate: true }),
    !vendors.isLoading && eligible.length > 0
  );
  const chosen = eligible.find((v) => v.id === vendorId);

  function submit(values: Values) {
    create.mutate(
      { vendorId: values.vendorId, note: values.note || null },
      {
        onSuccess: (created) => {
          onDone();
          onCreated(created);
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Generate API credential</DialogTitle>
        <DialogDescription>
          A Client ID and Client Secret for one vendor&apos;s own system. Every
          ticket it sends belongs to that vendor.
        </DialogDescription>
      </DialogHeader>

      {none ? (
        <p
          role="status"
          className="rounded-md bg-info-bg px-3 py-2.5 text-xs leading-relaxed text-info"
        >
          No vendor has the API channel switched on. Open Vendors, edit the
          vendor, tick API under Ticket intake, then come back.
        </p>
      ) : null}

      <Field data-invalid={errors.vendorId ? true : undefined}>
        <FieldLabel htmlFor="credential-vendor" required>
          Vendor
        </FieldLabel>
        <Controller
          name="vendorId"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(v) => field.onChange(v ?? "")}
              disabled={vendors.isLoading || eligible.length === 0}
            >
              <SelectTrigger
                id="credential-vendor"
                aria-invalid={errors.vendorId ? true : undefined}
                className="w-full"
              >
                <SelectValue
                  placeholder={
                    vendors.isLoading ? "Loading vendors…" : "Pick a vendor"
                  }
                >
                  {() => chosen?.name ?? "Pick a vendor"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {eligible.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.vendorId ? (
          <FieldDescription role="alert" className="text-danger">
            {errors.vendorId.message}
          </FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={errors.note ? true : undefined}>
        <FieldLabel htmlFor="credential-note">Label (optional)</FieldLabel>
        <Input
          id="credential-note"
          autoComplete="off"
          placeholder="e.g. Production CRM"
          aria-invalid={errors.note ? true : undefined}
          {...register("note")}
        />
        {errors.note ? (
          <FieldDescription role="alert" className="text-danger">
            {errors.note.message}
          </FieldDescription>
        ) : (
          <FieldDescription>
            Only for you — helps tell a vendor&apos;s credentials apart.
          </FieldDescription>
        )}
      </Field>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={create.isPending || none}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Generate credential
        </Button>
      </DialogFooter>
    </form>
  );
}
