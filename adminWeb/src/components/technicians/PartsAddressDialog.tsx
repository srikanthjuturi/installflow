import { useCallback, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AddressFields,
  type AddressStatus,
  type AddressValue,
} from "@/components/shared/AddressFields";
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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useSetPartsAddress } from "@/hooks/useTechnicians";
import type { PartsAddress } from "@/types/technician";
import {
  partsAddressSchema,
  toFormValues,
  toPartsAddressInput,
  type PartsAddressFormValues,
} from "./partsAddressSchema";

/* Search is off on purpose: this form never calls Google. The pincode is still
   checked against the geography master by AddressFields itself. */
const NO_SEARCH = { enabled: false, onSearch: () => {} };

/**
 * Add or change where spare parts are delivered for one technician (Epic 6).
 * Closed from the success handler only, so a 403 / 422 leaves it standing under
 * the toast (hard rule 9).
 */
export function PartsAddressDialog({
  open,
  onOpenChange,
  technicianId,
  technicianName,
  saved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicianId: string;
  technicianName: string;
  saved: PartsAddress | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open ? (
          <PartsAddressForm
            technicianId={technicianId}
            technicianName={technicianName}
            saved={saved}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PartsAddressForm({
  technicianId,
  technicianName,
  saved,
  onDone,
}: {
  technicianId: string;
  technicianName: string;
  saved: PartsAddress | null;
  onDone: () => void;
}) {
  const save = useSetPartsAddress();
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitted },
  } = useForm<PartsAddressFormValues>({
    resolver: zodResolver(partsAddressSchema),
    defaultValues: toFormValues(saved),
  });
  /* The state is the master's word for the pincode and is never sent, so it
     lives here rather than in the form. */
  const [state, setState] = useState("");
  const [status, setStatus] = useState<AddressStatus>("idle");
  const onStatusChange = useCallback((s: AddressStatus) => setStatus(s), []);

  const line = useWatch({ control, name: "line" });
  const city = useWatch({ control, name: "city" });
  const pincode = useWatch({ control, name: "pincode" });

  const write = (next: AddressValue) => {
    const opts = { shouldDirty: true, shouldValidate: isSubmitted };
    setValue("line", next.address, opts);
    setValue("city", next.city, opts);
    setValue("pincode", next.pincode, opts);
    setState(next.state);
  };

  const submit = async (v: PartsAddressFormValues) => {
    // A code the master does not hold is a real answer; "couldn't check" is not.
    if (status === "unknown") return;
    try {
      await save.mutateAsync({
        id: technicianId,
        body: toPartsAddressInput(v),
      });
      toast.add({ title: "Parts address saved" });
      onDone();
    } catch {
      /* The global handler has toasted it; what was typed stays. */
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {saved ? "Change parts address" : "Add parts address"}
        </DialogTitle>
        <DialogDescription>
          Where spare parts for {technicianName} are sent. Requests they raise
          from now on carry this address.
        </DialogDescription>
      </DialogHeader>

      <AddressFields
        idPrefix="parts-address"
        value={{
          address: line,
          addressLine2: "",
          city,
          state,
          pincode,
        }}
        onChange={write}
        onStatusChange={onStatusChange}
        addressSearch={NO_SEARCH}
        multiline
        autoFill={false}
        required={{ address: true, city: true, state: false, pincode: true }}
        labels={{ address: "Street address" }}
        errors={{
          address: errors.line?.message,
          city: errors.city?.message,
          pincode: errors.pincode?.message,
        }}
        grid="grid gap-4 sm:grid-cols-2"
        addressClassName="sm:col-span-2"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.landmark ? true : undefined}>
          <FieldLabel htmlFor="parts-address-landmark">Landmark</FieldLabel>
          <Input
            id="parts-address-landmark"
            aria-invalid={errors.landmark ? true : undefined}
            aria-describedby={
              errors.landmark ? "parts-address-landmark-error" : undefined
            }
            {...register("landmark")}
          />
          {errors.landmark ? (
            <FieldDescription
              id="parts-address-landmark-error"
              role="alert"
              className="text-danger"
            >
              {errors.landmark.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.contactPhone ? true : undefined}>
          <FieldLabel htmlFor="parts-address-phone">Contact phone</FieldLabel>
          <Input
            id="parts-address-phone"
            type="tel"
            inputMode="tel"
            aria-invalid={errors.contactPhone ? true : undefined}
            aria-describedby={
              errors.contactPhone
                ? "parts-address-phone-error"
                : "parts-address-phone-hint"
            }
            {...register("contactPhone")}
          />
          {errors.contactPhone ? (
            <FieldDescription
              id="parts-address-phone-error"
              role="alert"
              className="text-danger"
            >
              {errors.contactPhone.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="parts-address-phone-hint">
              Leave empty to use the technician&apos;s own phone.
            </FieldDescription>
          )}
        </Field>
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={save.isPending}>
              Cancel
            </Button>
          }
        />
        <Button
          type="submit"
          disabled={save.isPending || status === "unknown" || status === "checking"}
        >
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save address
        </Button>
      </DialogFooter>
    </form>
  );
}
