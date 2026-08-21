import { FormSection } from "@/components/shared/FormSection";
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
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CoverageFields } from "./CoverageFields";
import { Spinner } from "@/components/ui/spinner";
import { useCategoryTree } from "@/hooks/useProductMaster";
import {
  technicianSchema,
  type TechnicianFormValues,
} from "./technicianSchema";

const EMPTY: TechnicianFormValues = {
  name: "",
  phone: "",
  regionId: "",
  subcategoryIds: [],
  pincodes: [],
};

interface TechnicianFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TechnicianFormValues) => void;
  isSubmitting: boolean;
}

/**
 * Direct onboarding — the manager fills in everything and the technician just
 * signs in.
 *
 * Two columns at `md:`, one below: identity on the left, coverage on the right.
 * A job offer matches on category, pincode and free bandwidth, so none of the
 * right-hand column is optional — a technician missing any of it is never
 * notified about anything.
 */
export function TechnicianFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: TechnicianFormDialogProps) {
  const { data: tree, isLoading: loadingCategories } = useCategoryTree();

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
      {/* One column, not two. The form has a real dependency in it — a pincode
          cannot be searched until a region is chosen — and in the old
          side-by-side layout Region sat in the LEFT column while the field it
          governs sat in the right, so the one rule this form has was the least
          visible thing about it. Stacked, the three sections read as what they
          are: who the person is, where they work, what they can fix. */}
      <DialogContent className="scroll-slim max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add technician</DialogTitle>
          <DialogDescription>
            Jobs are offered on category and pincode, so both are required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="grid gap-6">
            {/* ── who they are ────────────────────────────────────────── */}
            <FormSection legend="Identity">
              <FieldGroup className="gap-4">
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

                {/* Paired: two short fields always filled together. */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={err("name") ? true : undefined}>
                    <FieldLabel htmlFor="tech-name">Full name</FieldLabel>
                    <Input
                      id="tech-name"
                      autoComplete="name"
                      placeholder="Full name"
                      aria-invalid={err("name") ? true : undefined}
                      aria-describedby={
                        err("name") ? "tech-name-error" : undefined
                      }
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
                        err("phone") ? "tech-phone-error" : "tech-phone-hint"
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
                    ) : (
                      <FieldDescription id="tech-phone-hint">
                        They sign in with this number and a one-time code.
                      </FieldDescription>
                    )}
                  </Field>
                </div>
              </FieldGroup>
            </FormSection>

            {/* ── where they work ─────────────────────────────────────── */}
            {/* Region and pincodes are ONE decision made in two steps, so they
                sit together and in that order. Region used to live under
                Identity, which is not what a region is: not who somebody is,
                but where they work. */}
            <FormSection legend="Coverage">
              <Controller
                name="regionId"
                control={control}
                render={({ field: region }) => (
                  <Controller
                    name="pincodes"
                    control={control}
                    render={({ field: pins }) => (
                      <CoverageFields
                        regionId={region.value}
                        pincodes={pins.value}
                        onRegionId={region.onChange}
                        onPincodes={pins.onChange}
                        regionError={err("regionId")}
                        pincodeError={err("pincodes")}
                      />
                    )}
                  />
                )}
              />
            </FormSection>

            {/* ── what they can fix ───────────────────────────────────── */}
            {/* Its own section rather than a fieldset buried under Coverage: a
                certification is a different question from a service area, and
                this list grows with the product master while Coverage does not.

                Subcategories sit under their parent's name — that is the level
                a job offer matches on, and ungrouped they read as one long flat
                list. */}
            <FormSection
              legend="Categories"
              hint="Only certified categories are offered to this technician."
            >
              <FieldSet
                data-invalid={err("subcategoryIds") ? true : undefined}
                aria-invalid={err("subcategoryIds") ? true : undefined}
                aria-describedby={
                  err("subcategoryIds") ? "tech-cats-error" : undefined
                }
              >
                {loadingCategories ? (
                  <FieldDescription>Loading categories…</FieldDescription>
                ) : (
                  <Controller
                    name="subcategoryIds"
                    control={control}
                    render={({ field }) => (
                      <div className="grid gap-3.5">
                        {(tree ?? []).map((category) => (
                          <div key={category.id}>
                            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                              {category.name}
                            </p>
                            <FieldGroup className="grid gap-2.5 sm:grid-cols-3">
                              {category.subcategories.map((sub) => {
                                const id = `tech-cat-${sub.id}`;
                                return (
                                  <Field key={sub.id} orientation="horizontal">
                                    <Checkbox
                                      id={id}
                                      checked={field.value.includes(sub.id)}
                                      onCheckedChange={(next) =>
                                        field.onChange(
                                          next
                                            ? [...field.value, sub.id]
                                            : field.value.filter(
                                                (v) => v !== sub.id
                                              )
                                        )
                                      }
                                    />
                                    <FieldLabel
                                      htmlFor={id}
                                      className="font-normal"
                                    >
                                      {sub.name}
                                    </FieldLabel>
                                  </Field>
                                );
                              })}
                            </FieldGroup>
                          </div>
                        ))}
                      </div>
                    )}
                  />
                )}
                {err("subcategoryIds") ? (
                  <FieldDescription
                    id="tech-cats-error"
                    role="alert"
                    className="text-danger"
                  >
                    {err("subcategoryIds")}
                  </FieldDescription>
                ) : null}
              </FieldSet>
            </FormSection>
          </div>

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
