import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Plus } from "lucide-react";
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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useFieldConflict } from "@/components/shared/useFieldConflict";
import { DISTRICT_CODES, PINCODE_CODES } from "@/lib/errorCodes";
import {
  useCreateDistrict,
  useCreatePincode,
  useDistricts,
  useStates,
  useUpdatePincode,
} from "@/hooks/useGeo";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import type { GeoPincode } from "@/types/geo";
import {
  EMPTY_PINCODE_FORM,
  pincodeResolver,
  type PincodeFormValues,
} from "./pincodeSchema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add. Pass a pincode to correct it in place. */
  pincode?: GeoPincode;
  /** Where the drill-down currently is, used to pre-fill a new pincode. The
   *  superadmin is nearly always already standing in the right state. */
  defaults?: { stateId?: string; districtId?: string };
  /**
   * Switching the code off, and back on. Both are raised to the caller rather
   * than run here: off needs a confirm dialog, and a confirm nested inside this
   * one would be a dialog over a dialog.
   */
  onSwitchOff?: (pincode: GeoPincode) => void;
  onSwitchOn?: (pincode: GeoPincode) => void;
}

/**
 * Add a pincode the spreadsheet does not have, or correct one it does.
 *
 * The dialog says out loud what happens on the next import, because the answer
 * differs by field and nobody could guess it: the importer never deletes what
 * the file omits, so an ADDED code is permanent, while the state and districts
 * of a code the sheet names are reset by the next upload.
 */
export function PincodeFormDialog({
  open,
  onOpenChange,
  pincode,
  defaults,
  onSwitchOff,
  onSwitchOn,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-xl">
        {/* Remounts on open so the form is always clean, and so reopening on a
            different chip does not keep the last one's districts. */}
        <PincodeForm
          key={pincode?.code ?? "new"}
          pincode={pincode}
          defaults={defaults}
          onSwitchOff={onSwitchOff}
          onSwitchOn={onSwitchOn}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PincodeForm({
  pincode,
  defaults,
  onSwitchOff,
  onSwitchOn,
  onDone,
}: {
  pincode?: GeoPincode;
  defaults?: { stateId?: string; districtId?: string };
  onSwitchOff?: (pincode: GeoPincode) => void;
  onSwitchOn?: (pincode: GeoPincode) => void;
  onDone: () => void;
}) {
  const isEdit = pincode !== undefined;
  const create = useCreatePincode();
  const update = useUpdatePincode();
  const pending = create.isPending || update.isPending;
  const codeConflict = useFieldConflict();

  const states = useStates();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<PincodeFormValues>({
    resolver: pincodeResolver(),
    defaultValues: pincode
      ? {
          code: pincode.code,
          stateId: pincode.stateId,
          districtIds: pincode.districtIds,
        }
      : {
          ...EMPTY_PINCODE_FORM,
          // Pre-filled from wherever the drill-down already is: somebody adding
          // a pincode is nearly always standing in the district it belongs to,
          // and both are editable, so a wrong guess costs one click.
          stateId: defaults?.stateId ?? "",
          districtIds: defaults?.districtId ? [defaults.districtId] : [],
        },
  });

  const stateId = useWatch({ control, name: "stateId" });
  const districtIds = useWatch({ control, name: "districtIds" });
  const code = useWatch({ control, name: "code" });

  // Only once a state is chosen: the district catalogue is 754 rows and the
  // list is meaningless until it can be scoped to one state.
  const districts = useDistricts({ stateId }, Boolean(stateId));

  const stateOptions: ComboboxOption[] = (states.data ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    hint: `${s.regionName} region`,
  }));
  useAutoSelectSingle(
    stateOptions.map((o) => o.value),
    stateId,
    (only) => setValue("stateId", only, { shouldValidate: true }),
    !states.isPending
  );

  // `messageFor` clears itself the moment the box stops holding the value the
  // server refused, which is exactly when it stops being true.
  const codeError = errors.code?.message ?? codeConflict.messageFor(code) ?? null;

  function submit(values: PincodeFormValues) {
    const body = {
      stateId: values.stateId,
      districtIds: values.districtIds,
    };
    const done = (verb: string) => {
      toast.add({ title: `${values.code} ${verb}` });
      onDone();
    };

    if (isEdit) {
      update.mutate(
        { code: pincode.code, input: body },
        { onSuccess: () => done("updated") }
      );
    } else {
      create.mutate(
        { code: values.code, ...body },
        {
          onSuccess: () => done("added"),
          // The toaster still fires (hard rule 9); this only decides whether
          // the message ALSO appears under the box that caused it.
          onError: (err) =>
            codeConflict.capture(err, values.code, PINCODE_CODES),
        }
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Edit ${pincode.code}` : "Add a pincode"}
        </DialogTitle>
        <DialogDescription>
          The spreadsheet is still the record. A pincode added here survives
          every import; the state and districts of one the sheet names are reset
          by the next upload.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={codeError ? true : undefined}>
          <FieldLabel htmlFor="pincode-code" required>
            Pincode
          </FieldLabel>
          <Input
            id="pincode-code"
            inputMode="numeric"
            maxLength={6}
            placeholder="e.g. 500001"
            // The primary key. Nothing in the schema protects the six
            // characters already copied into tickets, technician coverage and
            // invites, so a wrong code is switched off and re-added instead.
            readOnly={isEdit}
            disabled={isEdit}
            aria-invalid={codeError ? true : undefined}
            aria-describedby={
              codeError ? "pincode-code-error" : "pincode-code-hint"
            }
            {...register("code")}
          />
          {codeError ? (
            <FieldDescription
              id="pincode-code-error"
              role="alert"
              className="text-danger"
            >
              {codeError}
            </FieldDescription>
          ) : (
            <FieldDescription id="pincode-code-hint">
              {isEdit
                ? "A pincode cannot be renamed — tickets and coverage already store it. Switch it off and add the right one."
                : "Six digits, not starting with zero."}
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.stateId ? true : undefined}>
          <FieldLabel htmlFor="pincode-state" required>
            State
          </FieldLabel>
          <Controller
            name="stateId"
            control={control}
            render={({ field }) => (
              <Combobox
                id="pincode-state"
                value={
                  stateOptions.find((o) => o.value === field.value) ?? null
                }
                onValueChange={(next) => {
                  field.onChange(next?.value ?? "");
                  // A district id from the old state would be refused by the
                  // server anyway, and leaving stale chips on screen implies
                  // they survived the change.
                  setValue("districtIds", []);
                }}
                options={stateOptions}
                loading={states.isPending}
                emptyMessage="No states in the master"
                placeholder="Pick a state"
                aria-invalid={errors.stateId ? true : undefined}
              />
            )}
          />
          {errors.stateId ? (
            <FieldDescription
              id="pincode-state-error"
              role="alert"
              className="text-danger"
            >
              {errors.stateId.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="pincode-districts">Districts</FieldLabel>
          <Controller
            name="districtIds"
            control={control}
            render={({ field }) => (
              <MultiSelect
                id="pincode-districts"
                value={field.value}
                onValueChange={field.onChange}
                options={(districts.data ?? []).map((d) => ({
                  value: d.id,
                  label: d.name,
                }))}
                loading={districts.isPending && Boolean(stateId)}
                disabled={!stateId}
                placeholder={
                  stateId ? "Pick one or more" : "Pick a state first"
                }
                aria-describedby="pincode-districts-hint"
              />
            )}
          />
          <FieldDescription id="pincode-districts-hint">
            Districts can share a pincode — pick every one it reaches. Leave
            empty if the district is genuinely unknown.
          </FieldDescription>
          <AddDistrict
            stateId={stateId}
            onAdded={(id) => setValue("districtIds", [...districtIds, id])}
          />
        </Field>
      </FieldGroup>

      <DialogFooter>
        {/* On the left, away from Save: this is the only removal there is, and
            it must not sit under the thumb that is aiming for the primary. */}
        {isEdit && pincode.isActive && onSwitchOff ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger me-auto"
            onClick={() => onSwitchOff(pincode)}
          >
            Switch off
          </Button>
        ) : null}
        {isEdit && !pincode.isActive && onSwitchOn ? (
          <Button
            type="button"
            variant="outline"
            className="me-auto"
            onClick={() => onSwitchOn(pincode)}
          >
            Switch back on
          </Button>
        ) : null}
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Save changes" : "Add pincode"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Add a district without leaving the form.
 *
 * Here rather than on a screen of its own because of where it is needed: a
 * superadmin adds a pincode precisely when the master does not have it, and the
 * district it sits in is often missing for the same reason. Sending them
 * somewhere else to create one, then back to start the pincode again, is the
 * dead end this whole feature exists to remove.
 */
function AddDistrict({
  stateId,
  onAdded,
}: {
  stateId: string;
  onAdded: (districtId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createDistrict = useCreateDistrict();
  const conflict = useFieldConflict();

  if (!stateId) return null;

  const message = conflict.messageFor(name);

  function add() {
    const clean = name.trim();
    if (!clean) return;
    createDistrict.mutate(
      { stateId, name: clean },
      {
        onSuccess: (district) => {
          toast.add({ title: `${district.name} added` });
          onAdded(district.id);
          setName("");
          setOpen(false);
        },
        onError: (err) => conflict.capture(err, clean, DISTRICT_CODES),
      }
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1.5 justify-self-start"
        onClick={() => setOpen(true)}
      >
        <Plus data-icon="inline-start" />
        Add a district
      </Button>
    );
  }

  return (
    <div className="mt-1.5 grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          autoFocus
          placeholder="District name"
          aria-label="New district name"
          aria-invalid={message ? true : undefined}
          className="w-56"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Both stop the parent form: Enter here would submit the pincode
            // with a district that does not exist yet.
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={!name.trim() || createDistrict.isPending}
          onClick={add}
        >
          {createDistrict.isPending ? <Spinner data-icon="inline-start" /> : null}
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {message ? (
        <p role="alert" className="text-[12px] text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
