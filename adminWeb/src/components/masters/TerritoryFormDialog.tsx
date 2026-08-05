import { useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import type { RegionTerritory } from "@/types";
import {
  NEW_REGION,
  territorySchema,
  type TerritoryFormValues,
} from "./territorySchema";

const EMPTY: TerritoryFormValues = {
  region: "",
  newRegion: "",
  rsh: "",
  asm: "",
  area: "",
  pincodes: "",
};

interface TerritoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  regions: RegionTerritory[];
  onSubmit: (values: TerritoryFormValues) => void;
  isSubmitting: boolean;
}

/**
 * Maps an Area Service Manager, and the pincodes they service, into a region.
 * A new region needs its Regional Service Head named at the same time; an
 * existing one already has one.
 */
export function TerritoryFormDialog({
  open,
  onOpenChange,
  regions,
  onSubmit,
  isSubmitting,
}: TerritoryFormDialogProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TerritoryFormValues>({
    resolver: zodResolver(territorySchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) reset(EMPTY);
  }, [open, reset]);

  // Subscribes to one field only — watch() re-renders on every keystroke.
  const region = useWatch({ control, name: "region" });
  const isNewRegion = region === NEW_REGION;
  const rsh = regions.find((r) => r.region === region)?.rsh;

  const err = (name: keyof TerritoryFormValues) => errors[name]?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add mapping</DialogTitle>
          <DialogDescription>
            Region → Regional Service Head → Area Service Manager → serviced
            pincodes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={err("region") ? true : undefined}>
              <FieldLabel htmlFor="map-region">Region</FieldLabel>
              <Controller
                name="region"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="map-region"
                      className="w-full"
                      aria-invalid={err("region") ? true : undefined}
                      aria-describedby={
                        err("region") ? "map-region-error" : undefined
                      }
                    >
                      <SelectValue placeholder="Select a region" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {regions.map((r) => (
                          <SelectItem key={r.region} value={r.region}>
                            {r.region}
                          </SelectItem>
                        ))}
                        <SelectItem value={NEW_REGION}>New region…</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              {err("region") ? (
                <FieldDescription
                  id="map-region-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("region")}
                </FieldDescription>
              ) : rsh ? (
                <FieldDescription>RSH · {rsh}</FieldDescription>
              ) : null}
            </Field>

            {isNewRegion ? (
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={err("newRegion") ? true : undefined}>
                  <FieldLabel htmlFor="map-new-region">Region name</FieldLabel>
                  <Input
                    id="map-new-region"
                    placeholder="South"
                    aria-invalid={err("newRegion") ? true : undefined}
                    aria-describedby={
                      err("newRegion") ? "map-new-region-error" : undefined
                    }
                    {...register("newRegion")}
                  />
                  {err("newRegion") ? (
                    <FieldDescription
                      id="map-new-region-error"
                      role="alert"
                      className="text-danger"
                    >
                      {err("newRegion")}
                    </FieldDescription>
                  ) : null}
                </Field>

                <Field data-invalid={err("rsh") ? true : undefined}>
                  <FieldLabel htmlFor="map-rsh">
                    Regional Service Head
                  </FieldLabel>
                  <Input
                    id="map-rsh"
                    autoComplete="off"
                    placeholder="Full name"
                    aria-invalid={err("rsh") ? true : undefined}
                    aria-describedby={err("rsh") ? "map-rsh-error" : undefined}
                    {...register("rsh")}
                  />
                  {err("rsh") ? (
                    <FieldDescription
                      id="map-rsh-error"
                      role="alert"
                      className="text-danger"
                    >
                      {err("rsh")}
                    </FieldDescription>
                  ) : null}
                </Field>
              </FieldGroup>
            ) : null}

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={err("asm") ? true : undefined}>
                <FieldLabel htmlFor="map-asm">Area Service Manager</FieldLabel>
                <Input
                  id="map-asm"
                  autoComplete="off"
                  placeholder="Full name"
                  aria-invalid={err("asm") ? true : undefined}
                  aria-describedby={err("asm") ? "map-asm-error" : undefined}
                  {...register("asm")}
                />
                {err("asm") ? (
                  <FieldDescription
                    id="map-asm-error"
                    role="alert"
                    className="text-danger"
                  >
                    {err("asm")}
                  </FieldDescription>
                ) : null}
              </Field>

              <Field data-invalid={err("area") ? true : undefined}>
                <FieldLabel htmlFor="map-area">Area</FieldLabel>
                <Input
                  id="map-area"
                  autoComplete="off"
                  placeholder="Pune"
                  aria-invalid={err("area") ? true : undefined}
                  aria-describedby={err("area") ? "map-area-error" : undefined}
                  {...register("area")}
                />
                {err("area") ? (
                  <FieldDescription
                    id="map-area-error"
                    role="alert"
                    className="text-danger"
                  >
                    {err("area")}
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>

            <Field data-invalid={err("pincodes") ? true : undefined}>
              <FieldLabel htmlFor="map-pincodes">Serviced pincodes</FieldLabel>
              <Textarea
                id="map-pincodes"
                rows={2}
                inputMode="numeric"
                placeholder="411001, 411014, 411021"
                aria-invalid={err("pincodes") ? true : undefined}
                aria-describedby={
                  err("pincodes") ? "map-pincodes-error" : "map-pincodes-hint"
                }
                {...register("pincodes")}
              />
              {err("pincodes") ? (
                <FieldDescription
                  id="map-pincodes-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("pincodes")}
                </FieldDescription>
              ) : (
                <FieldDescription id="map-pincodes-hint">
                  6-digit pincodes, comma separated. A pincode belongs to one
                  ASM only.
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-5">
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              Add mapping
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
