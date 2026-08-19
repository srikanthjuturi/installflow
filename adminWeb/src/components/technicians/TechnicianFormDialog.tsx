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
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/hooks/useAuth";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useAssignableRegions } from "@/hooks/useCompanyUsers";
import { useCategoryTree } from "@/hooks/useProductMaster";
import {
  BANDWIDTH_OPTIONS,
  PINCODE_RE,
  technicianSchema,
  type TechnicianFormValues,
} from "./technicianSchema";

const EMPTY: TechnicianFormValues = {
  name: "",
  phone: "",
  regionId: "",
  subcategoryIds: [],
  pincodes: [],
  bwTotal: "",
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
  const { regions, isLoading: loadingRegions } = useAssignableRegions();
  const { data: me } = useMe();

  /**
   * An area manager may only assign pincodes they cover, so their field offers
   * exactly those and nothing else. Everyone above them types freely — there is
   * no pincode→region master to offer a list from.
   *
   * This is presentation. The server refuses an out-of-area pincode with a 403
   * naming it either way (hard rule 8).
   */
  const ownPincodes = me?.pincodes ?? [];
  const restrictToOwn = me?.role === "area_manager" && ownPincodes.length > 0;

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
      <DialogContent className="scroll-slim max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add technician</DialogTitle>
          <DialogDescription>
            Jobs are offered on category, pincode and free bandwidth. All three
            are required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="grid gap-6 md:grid-cols-2">
            {/* ── identity ────────────────────────────────────────────── */}
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

                <Field data-invalid={err("regionId") ? true : undefined}>
                  <FieldLabel htmlFor="tech-region">Region</FieldLabel>
                  <Controller
                    name="regionId"
                    control={control}
                    render={({ field }) => (
                      <RegionSelect
                        value={field.value}
                        onChange={field.onChange}
                        regions={regions}
                        disabled={loadingRegions}
                        invalid={Boolean(err("regionId"))}
                      />
                    )}
                  />
                  {err("regionId") ? (
                    <FieldDescription
                      id="tech-region-error"
                      role="alert"
                      className="text-danger"
                    >
                      {err("regionId")}
                    </FieldDescription>
                  ) : null}
                </Field>

                <Field data-invalid={err("bwTotal") ? true : undefined}>
                  <FieldLabel htmlFor="tech-bandwidth">Daily job cap</FieldLabel>
                  <Controller
                    name="bwTotal"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
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
            </FormSection>

            {/* ── coverage ────────────────────────────────────────────── */}
            <FormSection legend="Coverage">
              <FieldGroup className="gap-4">
                {/* A multi-choice set is checkboxes in a fieldset — the group
                    is named by its legend and described by the error.
                    Subcategories sit under their parent's name: that is the
                    level a job offer matches on, and ungrouped they read as
                    one long flat list. */}
                <FieldSet
                  data-invalid={err("subcategoryIds") ? true : undefined}
                  aria-invalid={err("subcategoryIds") ? true : undefined}
                  aria-describedby={
                    err("subcategoryIds") ? "tech-cats-error" : undefined
                  }
                >
                  <FieldLegend variant="label">Categories</FieldLegend>
                  <FieldDescription>
                    Only certified categories are offered to this technician.
                  </FieldDescription>
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
                              <FieldGroup className="grid gap-2.5 sm:grid-cols-2">
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

                <Field data-invalid={err("pincodes") ? true : undefined}>
                  <FieldLabel htmlFor="tech-pincodes">
                    Service pincodes
                  </FieldLabel>
                  <Controller
                    name="pincodes"
                    control={control}
                    render={({ field }) => (
                      <MultiSelect
                        id="tech-pincodes"
                        value={field.value}
                        onValueChange={field.onChange}
                        options={
                          restrictToOwn
                            ? ownPincodes.map((p) => ({ value: p, label: p }))
                            : undefined
                        }
                        allowCustom={!restrictToOwn}
                        // "411 014" pasted from a spreadsheet is a valid pincode.
                        normalizeCustom={(raw) => raw.replace(/\s+/g, "")}
                        validateCustom={(raw) =>
                          PINCODE_RE.test(raw.replace(/\s+/g, ""))
                            ? null
                            : "Pincodes are 6 digits"
                        }
                        placeholder={
                          restrictToOwn
                            ? "Pick from your areas"
                            : "Type a 6-digit pincode"
                        }
                        aria-invalid={err("pincodes") ? true : undefined}
                        aria-describedby={
                          err("pincodes")
                            ? "tech-pincodes-error"
                            : "tech-pincodes-hint"
                        }
                      />
                    )}
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
                      {restrictToOwn
                        ? "You can only add pincodes you cover."
                        : "6-digit pincodes. Press Enter after each."}
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>
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

/** A dropdown with a single choice fills itself — hard rule 10. An area
 *  manager holds exactly one region, so they never see this open. */
function RegionSelect({
  value,
  onChange,
  regions,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  regions: { id: string; name: string }[];
  disabled?: boolean;
  invalid?: boolean;
}) {
  useAutoSelectSingle(
    regions.map((r) => r.id),
    value,
    onChange,
    !disabled
  );
  const selected = regions.find((r) => r.id === value);

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v ?? "")}
      disabled={disabled}
    >
      <SelectTrigger
        id="tech-region"
        className="w-full"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? "tech-region-error" : undefined}
      >
        <SelectValue placeholder="Select a region">
          {() => selected?.name ?? "Select a region"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {regions.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
