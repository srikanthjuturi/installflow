import { FormSection } from "@/components/shared/FormSection";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CoverageFields } from "./CoverageFields";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useCategoryTree } from "@/hooks/useProductMaster";
import { useCreateTechnician, useUpdateTechnician } from "@/hooks/useTechnicians";
import { cn } from "@/lib/utils";
import type { Technician } from "@/types/technician";
import { formatPhone, toE164 } from "@/utils/phone";
import {
  TECHNICIAN_STATUSES,
  TECH_STATUS_LABEL,
  technicianSchema,
  type TechnicianFormValues,
} from "./technicianSchema";

interface TechnicianFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add. Pass a technician to edit them in place. */
  technician?: Technician;
}

/**
 * One form for both halves of direct onboarding's life: the manager fills
 * everything in, and later corrects it.
 *
 * Three sections, stacked rather than side by side. The form has a real
 * dependency in it — a pincode cannot be searched until a region is chosen —
 * and in the old two-column layout Region sat in the LEFT column while the
 * field it governs sat in the right, so the one rule this form has was the
 * least visible thing about it. Stacked, the sections read as what they are:
 * who the person is, where they work, what they can fix.
 *
 * A job offer matches on category, pincode and free bandwidth, so none of the
 * coverage half is optional — a technician missing any of it is never notified
 * about anything.
 */
export function TechnicianFormDialog({
  open,
  onOpenChange,
  technician,
}: TechnicianFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        {/* The popup unmounts on close, and the key remounts the form when the
            dialog is reopened against a different row — so an edit never opens
            holding the previous technician's values. */}
        <TechnicianForm
          key={technician?.id ?? "new"}
          technician={technician}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** What the bandwidth box holds for a technician with no limit set. */
const capOf = (cap: number | null) => (cap === null ? "" : String(cap));

function TechnicianForm({
  technician,
  onDone,
}: {
  technician?: Technician;
  onDone: () => void;
}) {
  const isEdit = technician !== undefined;
  const { data: tree, isLoading: loadingCategories } = useCategoryTree();
  const create = useCreateTechnician();
  const update = useUpdateTechnician();
  const pending = create.isPending || update.isPending;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TechnicianFormValues>({
    resolver: zodResolver(technicianSchema),
    defaultValues: {
      name: technician?.name ?? "",
      // Prefilled on edit so the schema is satisfied, then never submitted —
      // the phone IS the credential a technician signs in with, and the API
      // does not accept a change to it. Same reasoning as the vendor form's
      // login email.
      phone: technician?.phone ?? "",
      regionId: technician?.regionId ?? "",
      subcategoryIds: technician?.subcategories.map((s) => s.id) ?? [],
      pincodes: technician?.pincodes ?? [],
      photo: technician?.profileImageUrl ?? undefined,
      dailyJobCap: capOf(technician?.dailyJobCap ?? null),
      status: technician?.status ?? "active",
    },
  });

  // The initials fallback should track the name as it is typed, before a photo
  // is chosen. `useWatch` subscribes to just this field (and, unlike `watch()`,
  // does not opt the whole form out of the React Compiler).
  const watchedName = useWatch({ control, name: "name" });

  const err = (name: keyof TechnicianFormValues) => errors[name]?.message;

  function submit(values: TechnicianFormValues) {
    if (isEdit) {
      update.mutate(
        {
          id: technician.id,
          fullName: values.name,
          // Always sent, both of these, so clearing is possible: the API reads
          // them off `model_fields_set`, where an absent key means "leave it
          // alone" and an explicit null means "no photo" / "no limit".
          profileImageUrl: values.photo ?? null,
          dailyJobCap:
            values.dailyJobCap === "" ? null : Number(values.dailyJobCap),
          regionId: values.regionId,
          subcategoryIds: values.subcategoryIds,
          pincodes: values.pincodes,
          status: values.status,
        },
        {
          onSuccess: (saved) => {
            toast.add({
              title: `${saved.name} updated`,
              description: `${saved.code} · ${
                saved.dailyJobCap ? `${saved.dailyJobCap} jobs/day` : "no daily limit"
              } · ${TECH_STATUS_LABEL[saved.status]}.`,
            });
            onDone();
          },
        }
      );
      return;
    }

    create.mutate(
      {
        fullName: values.name,
        phone: toE164(values.phone),
        regionId: values.regionId,
        subcategoryIds: values.subcategoryIds,
        pincodes: values.pincodes,
        // No dailyJobCap: a new technician starts uncapped and sets their own
        // in the app. It becomes editable here once there is a day's work to
        // base a number on.
        profileImageUrl: values.photo ?? null,
      },
      {
        onSuccess: (saved) => {
          toast.add({
            title: `${saved.name} added`,
            description: saved.dailyJobCap
              ? `${saved.code} · ${saved.dailyJobCap} jobs/day.`
              : `${saved.code} · no daily limit yet.`,
          });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Edit ${technician.name}` : "Add technician"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? `${technician.code} · jobs are offered on category and pincode, so both stay required.`
            : "Jobs are offered on category and pincode, so both are required."}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-5 grid gap-6">
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
                <FieldLabel htmlFor="tech-name" required>
                  Full name
                </FieldLabel>
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

              {isEdit ? (
                /* Read-only, and not registered to the form: the number a
                   technician signs in with cannot be moved from here, so the
                   box shows the stored one formatted rather than offering an
                   edit the API would refuse. No asterisk either — an
                   unanswerable field must not ask to be answered. */
                <Field>
                  <FieldLabel htmlFor="tech-phone">Mobile number</FieldLabel>
                  <Input
                    id="tech-phone"
                    readOnly
                    disabled
                    value={formatPhone(technician.phone)}
                    aria-describedby="tech-phone-hint"
                  />
                  <FieldDescription id="tech-phone-hint">
                    The number they sign in with. It can&apos;t be changed here.
                  </FieldDescription>
                </Field>
              ) : (
                <Field data-invalid={err("phone") ? true : undefined}>
                  <FieldLabel htmlFor="tech-phone" required>
                    Mobile number
                  </FieldLabel>
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
              )}
            </div>
          </FieldGroup>
        </FormSection>

        {/* ── where they work ─────────────────────────────────────── */}
        {/* Region and pincodes are ONE decision made in two steps, so they sit
            together and in that order. Region used to live under Identity,
            which is not what a region is: not who somebody is, but where they
            work. Changing it clears the pincodes — they are not in the new
            region and the server would refuse them. */}
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
            certification is a different question from a service area, and this
            list grows with the product master while Coverage does not.

            Subcategories sit under their parent's name — that is the level a
            job offer matches on, and ungrouped they read as one long flat
            list. */}
        <FormSection
          legend="Categories"
          required
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
                                <FieldLabel htmlFor={id} className="font-normal">
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

        {/* ── how much work, and whether any ──────────────────────── */}
        {/* Edit only. Neither question can be answered honestly at intake: a cap
            invented before anybody has worked a day is a number nobody has a
            basis for, and a technician being added is being added because they
            are active. */}
        {isEdit ? (
          <FormSection
            legend="Bandwidth & status"
            hint="What this technician can take on, and whether they are taking anything at all."
          >
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={err("dailyJobCap") ? true : undefined}>
                <FieldLabel htmlFor="tech-cap">Jobs per day</FieldLabel>
                <Input
                  id="tech-cap"
                  inputMode="numeric"
                  className="tabular-nums"
                  placeholder="No limit"
                  aria-invalid={err("dailyJobCap") ? true : undefined}
                  aria-describedby={
                    err("dailyJobCap") ? "tech-cap-error" : "tech-cap-hint"
                  }
                  {...register("dailyJobCap")}
                />
                {err("dailyJobCap") ? (
                  <FieldDescription
                    id="tech-cap-error"
                    role="alert"
                    className="text-danger"
                  >
                    {err("dailyJobCap")}
                  </FieldDescription>
                ) : (
                  <FieldDescription id="tech-cap-hint">
                    Counted by the day the work happens. Leave it blank for no
                    limit — the technician can set their own in the app.
                  </FieldDescription>
                )}
              </Field>

              {/* A plain FieldSet with its own legend — a sub-group inside a
                  section, not a peer of it. See `FormSection`. */}
              <FieldSet data-invalid={err("status") ? true : undefined}>
                <FieldLegend variant="label" className="mb-0 font-medium">
                  Status
                </FieldLegend>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <RadioGroup
                      aria-label="Status"
                      value={field.value}
                      onValueChange={(v) => field.onChange(v)}
                      aria-invalid={err("status") ? true : undefined}
                      aria-describedby="tech-status-hint"
                      className="grid grid-cols-3 gap-2"
                    >
                      {TECHNICIAN_STATUSES.map((s) => (
                        <label
                          key={s}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2.5 text-[13px] transition-colors",
                            field.value === s
                              ? "border-brand-500 bg-brand-100/40"
                              : "border-line hover:border-brand-400"
                          )}
                        >
                          <RadioGroupItem value={s} />
                          <span>{TECH_STATUS_LABEL[s]}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                />
                <FieldDescription id="tech-status-hint">
                  Only an Active technician is offered jobs or can accept from
                  the pool.
                </FieldDescription>
              </FieldSet>
            </FieldGroup>
          </FormSection>
        ) : null}
      </div>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter className="mt-5">
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {isEdit ? "Save changes" : "Add technician"}
        </Button>
      </DialogFooter>
    </form>
  );
}
