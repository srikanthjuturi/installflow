import { useForm } from "react-hook-form";
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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  useCreatePurchasePlatform,
  useUpdatePurchasePlatform,
} from "@/hooks/usePurchasePlatforms";
import type { PurchasePlatform } from "@/types/purchasePlatform";

/** Mirrors the server's own bound — `MAX_PLATFORM_NAME` in
 *  `api/app/models/purchase_platform.py`. */
const MAX_PLATFORM_NAME = 120;

/** Trimmed and collapsed the same way the server does before its own length
 *  check, so a name of pure spaces is refused here rather than round-tripping
 *  to a 409 for an empty string nobody can find on the list. */
const schema = z.object({
  name: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(1, "Enter a name")
        .max(MAX_PLATFORM_NAME, `Keep it under ${MAX_PLATFORM_NAME} characters`)
    ),
});
type Values = z.infer<typeof schema>;

/**
 * Add a purchase platform, or rename one — one dialog for both, the same
 * shape `OwnBrandDialog` uses for a vendor's own brands. Admin only: the page
 * hides the trigger from anyone else, and the server refuses the write
 * regardless (hard rule 8). The server also 409s a name that already exists
 * for this company (case-insensitive); the toaster shows its own sentence.
 */
export function PurchasePlatformDialog({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add. Pass a platform to rename it. */
  platform?: PurchasePlatform;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Unmounts on close, so a rename never opens holding a stale name. */}
        <PurchasePlatformForm
          platform={platform}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PurchasePlatformForm({
  platform,
  onDone,
}: {
  platform?: PurchasePlatform;
  onDone: () => void;
}) {
  const isEdit = platform !== undefined;
  const create = useCreatePurchasePlatform();
  const update = useUpdatePurchasePlatform();
  const pending = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: platform?.name ?? "" },
  });

  function submit({ name }: Values) {
    const done = () => {
      toast.add({ title: `${name} ${isEdit ? "renamed" : "added"}` });
      onDone();
    };
    if (isEdit) {
      update.mutate({ id: platform.id, name }, { onSuccess: done });
    } else {
      create.mutate({ name }, { onSuccess: done });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Rename ${platform.name}` : "Add a purchase platform"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "The new name appears on the raise-a-ticket form at once."
            : "A vendor picks this when a customer bought online — Amazon, Flipkart, your own site."}
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="purchase-platform-name" required>
          Platform name
        </FieldLabel>
        <Input
          id="purchase-platform-name"
          autoFocus
          autoComplete="off"
          placeholder="e.g. Amazon"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={
            errors.name ? "purchase-platform-name-error" : undefined
          }
          {...register("name")}
        />
        {errors.name ? (
          <FieldDescription
            id="purchase-platform-name-error"
            role="alert"
            className="text-danger"
          >
            {errors.name.message}
          </FieldDescription>
        ) : null}
      </Field>

      {/* The failure is reported in the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" disabled={pending} />}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Save changes" : "Add platform"}
        </Button>
      </DialogFooter>
    </form>
  );
}
