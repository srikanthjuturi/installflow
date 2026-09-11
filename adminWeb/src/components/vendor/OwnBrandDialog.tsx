import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MAX_BRAND_NAME } from "@/components/masters/vendorSchema";
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
import { useSubmitOwnBrand, useUpdateOwnBrand } from "@/hooks/useVendors";
import type { VendorBrand } from "@/types/vendor";

/** The same rule the vendor form's Brands rows use, and the API's. */
const schema = z.object({
  name: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(2, "A brand name needs at least 2 characters")
        .max(MAX_BRAND_NAME, `Keep it under ${MAX_BRAND_NAME} characters`)
    ),
});
type Values = z.infer<typeof schema>;

/**
 * A vendor naming a brand it sells — new, or corrected after a refusal.
 *
 * Either way it goes to the office for a yes: a brand is what a technician and
 * a customer read on every job, so the company decides which ones it stands
 * behind. Until then no product can carry it, which the description says
 * before they press the button rather than after.
 */
export function OwnBrandDialog({
  open,
  onOpenChange,
  brand,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add. A pending or rejected brand to rename it. */
  brand?: VendorBrand;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <OwnBrandForm brand={brand} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function OwnBrandForm({
  brand,
  onDone,
}: {
  brand?: VendorBrand;
  onDone: () => void;
}) {
  const submit_ = useSubmitOwnBrand();
  const update = useUpdateOwnBrand();
  const pending = submit_.isPending || update.isPending;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: brand?.name ?? "" },
  });

  function submit({ name }: Values) {
    const done = () => {
      toast.add({
        title: `${name} sent for approval`,
        description: "You can put it on your products once it is approved.",
      });
      onDone();
    };
    if (brand) update.mutate({ id: brand.id, name }, { onSuccess: done });
    else submit_.mutate(name, { onSuccess: done });
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{brand ? `Edit ${brand.name}` : "Add a brand"}</DialogTitle>
        <DialogDescription>
          {brand?.approvalStatus === "rejected"
            ? "Saving sends it back for approval."
            : "We approve each brand before your products can carry it."}
        </DialogDescription>
      </DialogHeader>

      {brand?.approvalStatus === "rejected" && brand.rejectionReason ? (
        <p className="rounded-md bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
          Not approved: {brand.rejectionReason}
        </p>
      ) : null}

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="own-brand-name" required>
          Brand name
        </FieldLabel>
        <Input
          id="own-brand-name"
          autoFocus
          autoComplete="off"
          placeholder="e.g. Sunview"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={
            errors.name ? "own-brand-name-error" : "own-brand-name-hint"
          }
          {...register("name")}
        />
        {errors.name ? (
          <FieldDescription
            id="own-brand-name-error"
            role="alert"
            className="text-danger"
          >
            {errors.name.message}
          </FieldDescription>
        ) : (
          <FieldDescription id="own-brand-name-hint">
            As it is printed on the product.
          </FieldDescription>
        )}
      </Field>

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" disabled={pending} />}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Send for approval
        </Button>
      </DialogFooter>
    </form>
  );
}
