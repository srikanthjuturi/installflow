import { lazy, Suspense, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MapPinOff } from "lucide-react";
import { FieldGrid } from "@/components/shared/FieldGrid";
import { Notice } from "@/components/shared/Notice";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useFieldConflict } from "@/components/shared/useFieldConflict";
import { usePincodeLookup } from "@/hooks/useGeo";
import { useSetBaseLocation } from "@/hooks/useTechnicians";
import { BASE_PINCODE_CODES, BASE_POINT_CODES } from "@/lib/errorCodes";
import type { BaseLocation } from "@/types/allowances";
import {
  baseFormSchema,
  roundCoord,
  toBaseBody,
  type BaseFormValues,
} from "./baseLocation";

/* Leaflet is ~45 kB gzipped and nobody who never opens this dialog should pay
   for it: the map is its own chunk, and so is its stylesheet. */
const BaseLocationMap = lazy(() => import("@/components/geo/BaseLocationMap"));

const PINCODE_RE = /^\d{6}$/;

/**
 * Where a technician's travel allowance is measured from (Task 13 §5.5, TA7).
 *
 * Three ways in, one write: a **pincode's centre** (Use centre), a **pin** on an
 * OpenStreetMap (click or drag), or **typed coordinates** (always visible, so a
 * map that will not load is never a dead end). Mode follows the LAST thing the
 * admin did — typing a latitude after dragging the pin means "manual", pressing
 * Use centre means "pincode" — and `toBaseBody` sends only what that mode owns.
 *
 * Server refusals land on the field that owns them (`PINCODE_OUTSIDE_FRANCHISEE`
 * and `PINCODE_HAS_NO_LOCATION` on the pincode, `BASE_OUTSIDE_INDIA` on the
 * coordinates) and the toaster still shows the server's sentence — hard rule 9.
 * There is no approval and no cooldown (R9): a save is immediate, and it moves
 * only jobs accepted from now on.
 *
 * Mounted only while open, so every opening starts from the technician's
 * current base.
 */
export function BaseLocationDialog({
  open,
  onOpenChange,
  technician,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician: { id: string; name: string; baseLocation?: BaseLocation | null };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Base location · {technician.name}</DialogTitle>
          <DialogDescription>
            Click the map or drag the pin, start from a pincode&apos;s centre,
            or type the coordinates.
          </DialogDescription>
        </DialogHeader>
        <BaseLocationForm
          technician={technician}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type Centred = "moved" | "saved-as-centre" | null;

function BaseLocationForm({
  technician,
  onDone,
}: {
  technician: { id: string; name: string; baseLocation?: BaseLocation | null };
  onDone: () => void;
}) {
  const base = technician.baseLocation ?? null;
  const save = useSetBaseLocation();
  const pincodeConflict = useFieldConflict();
  const pointConflict = useFieldConflict();

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<BaseFormValues>({
    resolver: zodResolver(baseFormSchema),
    defaultValues: {
      mode: base?.source === "pincode" ? "pincode" : "map",
      pincode: base?.pincode ?? "",
      latitude: base ? String(roundCoord(base.latitude)) : "",
      longitude: base ? String(roundCoord(base.longitude)) : "",
    },
  });

  const values = useWatch({ control });
  const lat = Number(values.latitude);
  const lng = Number(values.longitude);
  const hasPoint =
    (values.latitude ?? "").trim() !== "" &&
    (values.longitude ?? "").trim() !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  const pin = hasPoint ? { lat, lng } : null;

  // Bumped when a point arrives from OUTSIDE the map (Use centre, typing), so
  // the view follows it; a click or drag never bumps it.
  const [recentre, setRecentre] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [centred, setCentred] = useState<Centred>(null);

  const code = (values.pincode ?? "").trim();
  const lookup = usePincodeLookup(code);
  const complete = PINCODE_RE.test(code);

  const useCentre = () => {
    const row = lookup.data;
    if (!row) return; // null → the note below says so; error → never blocks
    setValue("mode", "pincode", { shouldValidate: true });
    if (row.latitude != null && row.longitude != null) {
      setValue("latitude", String(roundCoord(row.latitude)));
      setValue("longitude", String(roundCoord(row.longitude)));
      setRecentre((n) => n + 1);
      setCentred("moved");
    } else {
      // Saves as the pincode alone; the server answers with its centre, or
      // refuses PINCODE_HAS_NO_LOCATION (shown on this field).
      setCentred("saved-as-centre");
    }
  };

  const pick = (p: { lat: number; lng: number }) => {
    setValue("mode", "map", { shouldValidate: true });
    setValue("latitude", String(roundCoord(p.lat)), { shouldValidate: true });
    setValue("longitude", String(roundCoord(p.lng)), { shouldValidate: true });
    setCentred(null);
  };

  const onSubmit = async (v: BaseFormValues) => {
    try {
      await save.mutateAsync({ id: technician.id, body: toBaseBody(v) });
      toast.add({
        title: "Base location saved",
        description: `Jobs ${technician.name} accepts from now on measure travel from here.`,
      });
      onDone();
    } catch (err) {
      // Pin the code to its field; the global handler has toasted the sentence.
      pincodeConflict.capture(err, v.pincode, BASE_PINCODE_CODES);
      pointConflict.capture(err, `${v.latitude},${v.longitude}`, BASE_POINT_CODES);
    }
  };

  const pincodeError =
    errors.pincode?.message ??
    pincodeConflict.messageFor(values.pincode ?? "") ??
    undefined;
  const latError =
    errors.latitude?.message ??
    pointConflict.messageFor(`${values.latitude},${values.longitude}`) ??
    undefined;
  const lngError = errors.longitude?.message;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      <Field data-invalid={pincodeError ? true : undefined}>
        <FieldLabel htmlFor="base-pincode">Pincode</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="base-pincode"
            inputMode="numeric"
            maxLength={6}
            className="max-w-40"
            aria-invalid={pincodeError ? true : undefined}
            aria-describedby="base-pincode-note"
            {...register("pincode", {
              // The box is a way in too: typing a code means "this pincode",
              // pressed Use centre or not. Dragging the pin afterwards takes
              // the mode back to "map" — the last thing done wins.
              onChange: () => {
                setValue("mode", "pincode");
                setCentred(null);
              },
            })}
          />
          <Button
            type="button"
            variant="outline"
            // A real row is the only thing worth pressing for; null / error say
            // why in the note beside it rather than going quiet.
            disabled={!complete || lookup.isFetching || !lookup.data}
            onClick={useCentre}
          >
            Use centre
          </Button>
        </div>
        <FieldDescription
          id="base-pincode-note"
          role={pincodeError ? "alert" : undefined}
          className={pincodeError ? "text-danger" : undefined}
        >
          {pincodeError ??
            (complete && lookup.isError
              ? "Couldn't check that pincode."
              : complete && !lookup.isFetching && lookup.data === null
                ? "We don't service that pincode."
                : centred === "saved-as-centre"
                  ? "Saved as the pincode's centre."
                  : null)}
        </FieldDescription>
      </Field>

      {tilesFailed ? (
        <Notice tone="warn" icon={MapPinOff} title="The map couldn't load. Type the coordinates instead.">
          The two boxes below still save.
        </Notice>
      ) : null}
      <Suspense fallback={<Skeleton className="h-80 w-full rounded-md" />}>
        <BaseLocationMap
          value={pin}
          recentre={recentre}
          onPick={pick}
          onTilesFailed={() => setTilesFailed(true)}
        />
      </Suspense>

      {/* Always visible — a map that will not load must never be a dead end. */}
      <FieldGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field data-invalid={latError ? true : undefined}>
          <FieldLabel htmlFor="base-lat">Latitude</FieldLabel>
          <Input
            id="base-lat"
            inputMode="decimal"
            aria-invalid={latError ? true : undefined}
            aria-describedby={latError ? "base-lat-error" : undefined}
            {...register("latitude", {
              onChange: () => {
                setValue("mode", "manual");
                setCentred(null);
              },
            })}
          />
          {latError ? (
            <FieldDescription id="base-lat-error" role="alert" className="text-danger">
              {latError}
            </FieldDescription>
          ) : null}
        </Field>
        <Field data-invalid={lngError ? true : undefined}>
          <FieldLabel htmlFor="base-lng">Longitude</FieldLabel>
          <Input
            id="base-lng"
            inputMode="decimal"
            aria-invalid={lngError ? true : undefined}
            aria-describedby={lngError ? "base-lng-error" : undefined}
            {...register("longitude", {
              onChange: () => {
                setValue("mode", "manual");
                setCentred(null);
              },
            })}
          />
          {lngError ? (
            <FieldDescription id="base-lng-error" role="alert" className="text-danger">
              {lngError}
            </FieldDescription>
          ) : null}
        </Field>
      </FieldGrid>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save base location
        </Button>
      </DialogFooter>
    </form>
  );
}
