import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { AvatarPicker } from "@/components/shared/AvatarPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useCategories } from "@/hooks/useMasters";
import {
  BANDWIDTH_OPTIONS,
  technicianSchema,
  type TechnicianFormValues,
} from "./technicianSchema";

const EMPTY: TechnicianFormValues = {
  name: "",
  phone: "",
  cats: [],
  pincodes: "",
  bwTotal: "",
};

interface TechnicianFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TechnicianFormValues) => void;
  isSubmitting: boolean;
}

/**
 * Onboarding form. Category, pincode and bandwidth are the three things a job
 * offer matches on, so none of them is optional here.
 */
export function TechnicianFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: TechnicianFormDialogProps) {
  const { data: categories, isLoading: loadingCategories } = useCategories();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TechnicianFormValues>({
    resolver: zodResolver(technicianSchema),
    defaultValues: EMPTY,
  });

  // The initials fallback should track the name as it is typed, before a photo
  // is chosen. `useWatch` subscribes to just this field (and, unlike `watch()`,
  // does not opt the whole form out of the React Compiler).
  const watchedName = useWatch({ control, name: "name" });

  // The dialog stays mounted, so a reopened form would otherwise still hold
  // the last attempt.
  useEffect(() => {
    if (open) reset(EMPTY);
  }, [open, reset]);

  const err = (name: keyof TechnicianFormValues) => errors[name]?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add technician</DialogTitle>
          <DialogDescription>
            Jobs are offered on category, pincode and free bandwidth. All three
            are required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field orientation="horizontal">
              <Controller
                name="photo"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-4">
                    <AvatarPicker
                      name={watchedName}
                      value={field.value ?? null}
                      onChange={(v) => field.onChange(v ?? undefined)}
                      label="technician"
                      avatarClassName="size-16 text-xl"
                    />
                    <div className="min-w-0">
                      <FieldLabel>Profile photo</FieldLabel>
                      <FieldDescription>
                        Optional. Tap the camera to add and crop a clear face
                        photo.
                      </FieldDescription>
                      {field.value ? (
                        <button
                          type="button"
                          onClick={() => field.onChange(undefined)}
                          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-danger"
                        >
                          <Trash2 className="size-3" aria-hidden />
                          Remove photo
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              />
            </Field>

            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={err("name") ? true : undefined}>
                <FieldLabel htmlFor="tech-name">Full name</FieldLabel>
                <Input
                  id="tech-name"
                  autoComplete="name"
                  placeholder="Full name"
                  aria-invalid={err("name") ? true : undefined}
                  aria-describedby={err("name") ? "tech-name-error" : undefined}
                  {...register("name")}
                />
                {err("name") ? (
                  <FieldDescription
                    id="tech-name-error"
                    role="alert"
                    className="text-danger"
                  >
                    {err("name")}
                  </FieldDescription>
                ) : null}
              </Field>

              <Field data-invalid={err("phone") ? true : undefined}>
                <FieldLabel htmlFor="tech-phone">Mobile number</FieldLabel>
                <Input
                  id="tech-phone"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 "
                  aria-invalid={err("phone") ? true : undefined}
                  aria-describedby={
                    err("phone") ? "tech-phone-error" : undefined
                  }
                  {...register("phone")}
                />
                {err("phone") ? (
                  <FieldDescription
                    id="tech-phone-error"
                    role="alert"
                    className="text-danger"
                  >
                    {err("phone")}
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>

            {/* A multi-choice set is checkboxes in a fieldset — the group is
                named by its legend and described by the error. */}
            <FieldSet
              data-invalid={err("cats") ? true : undefined}
              aria-invalid={err("cats") ? true : undefined}
              aria-describedby={err("cats") ? "tech-cats-error" : undefined}
            >
              <FieldLegend variant="label">Categories</FieldLegend>
              <FieldDescription>
                Only certified categories are offered to this technician.
              </FieldDescription>
              {loadingCategories ? (
                <FieldDescription>Loading categories…</FieldDescription>
              ) : (
                <Controller
                  name="cats"
                  control={control}
                  render={({ field }) => (
                    <FieldGroup className="grid gap-2.5 sm:grid-cols-2">
                      {(categories ?? [])
                        .filter((c) => c.active)
                        .map((c) => {
                          const id = `tech-cat-${c.name.replace(/\s+/g, "-").toLowerCase()}`;
                          const checked = field.value.includes(c.name);
                          return (
                            <Field key={c.name} orientation="horizontal">
                              <Checkbox
                                id={id}
                                checked={checked}
                                onCheckedChange={(next) =>
                                  field.onChange(
                                    next
                                      ? [...field.value, c.name]
                                      : field.value.filter((v) => v !== c.name)
                                  )
                                }
                              />
                              <FieldLabel htmlFor={id} className="font-normal">
                                {c.name}
                              </FieldLabel>
                            </Field>
                          );
                        })}
                    </FieldGroup>
                  )}
                />
              )}
              {err("cats") ? (
                <FieldDescription
                  id="tech-cats-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("cats")}
                </FieldDescription>
              ) : null}
            </FieldSet>

            <Field data-invalid={err("pincodes") ? true : undefined}>
              <FieldLabel htmlFor="tech-pincodes">Service pincodes</FieldLabel>
              <Textarea
                id="tech-pincodes"
                rows={2}
                inputMode="numeric"
                placeholder="411014, 411028, 411045"
                aria-invalid={err("pincodes") ? true : undefined}
                aria-describedby={
                  err("pincodes") ? "tech-pincodes-error" : "tech-pincodes-hint"
                }
                {...register("pincodes")}
              />
              {err("pincodes") ? (
                <FieldDescription
                  id="tech-pincodes-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("pincodes")}
                </FieldDescription>
              ) : (
                <FieldDescription id="tech-pincodes-hint">
                  6-digit pincodes, comma separated.
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={err("bwTotal") ? true : undefined}>
              <FieldLabel htmlFor="tech-bandwidth">Daily job cap</FieldLabel>
              <Controller
                name="bwTotal"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="tech-bandwidth"
                      className="w-full"
                      aria-invalid={err("bwTotal") ? true : undefined}
                      aria-describedby={
                        err("bwTotal")
                          ? "tech-bandwidth-error"
                          : "tech-bandwidth-hint"
                      }
                    >
                      <SelectValue placeholder="Select a cap" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {BANDWIDTH_OPTIONS.map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              {err("bwTotal") ? (
                <FieldDescription
                  id="tech-bandwidth-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("bwTotal")}
                </FieldDescription>
              ) : (
                <FieldDescription id="tech-bandwidth-hint">
                  Jobs per day, 1 to 12.
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
              Add technician
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
