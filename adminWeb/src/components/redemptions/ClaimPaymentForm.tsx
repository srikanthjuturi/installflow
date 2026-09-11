import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImageUp, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useClaimRedemption } from "@/hooks/useRedemptions";
import { describeError } from "@/lib/apiError";
import { MAX_UPLOAD_BYTES, uploadImage } from "@/services/uploads";

/** What blob storage takes — mirrors `ALLOWED_CONTENT_TYPES` in the API. */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const ACCEPTED_TYPES = ACCEPT.split(",");

/** The server's own rule (`redemptions/schemas._UTR`), after dropping spaces. */
const UTR = /^[A-Za-z0-9]{6,35}$/;

/**
 * The screenshot is REQUIRED and the UTR is not, and the asymmetry is the
 * point: the screenshot is on the payer's phone at this exact moment, while a
 * UTR is a string they would have to go and find and could mistype. Neither
 * proves anything on its own — which is why the technician still confirms.
 */
const claimSchema = z.object({
  screenshot: z
    .instanceof(File)
    .nullable()
    // An explicit `boolean` return: TypeScript would otherwise infer `f !== null`
    // as a type predicate, narrowing the OUTPUT to `File` while the form's
    // default stays `null` — two types for one field, and RHF refuses the pair.
    .refine((f): boolean => f !== null, "Attach the payment screenshot"),
  utr: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || UTR.test(v.replace(/\s+/g, "")),
      "Enter the UTR as it appears in your UPI app — letters and digits, 6 to 35 of them"
    ),
});

type ClaimFormValues = z.infer<typeof claimSchema>;

/**
 * "I paid", with the screenshot that shows it.
 *
 * One file, and no crop dialog — the force-close exception, for its reason:
 * cropping evidence removes the thing it was attached to prove. A preview is
 * shown instead, because the likeliest mistake is picking the wrong screenshot
 * out of a gallery full of them.
 *
 * Upload first, then claim — never the other way round, or a claim would be
 * recorded pointing at a file that never arrived. The upload is a bare call, so
 * its failure is toasted here: the mutation's global handler never sees it.
 */
export function ClaimPaymentForm({ redemptionId }: { redemptionId: string }) {
  const claim = useClaimRedemption();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [refusedFile, setRefusedFile] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: { screenshot: null, utr: "" },
  });

  const screenshot = useWatch({ control, name: "screenshot" });
  const preview = usePreview(screenshot);
  const busy = uploading || claim.isPending;

  const pick = (list: FileList | null) => {
    const file = list?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_UPLOAD_BYTES) {
      // Named, not dropped — see the same rule in `ForceCloseForm`.
      setRefusedFile(file.name);
      return;
    }
    setRefusedFile(null);
    setValue("screenshot", file, { shouldValidate: true });
  };

  async function submit(values: ClaimFormValues) {
    if (!values.screenshot) return;
    setUploading(true);
    let blobName: string;
    try {
      blobName = await uploadImage(values.screenshot, "attachment");
    } catch (err) {
      const { title, description } = describeError(
        err,
        "Couldn't upload the screenshot"
      );
      toast.add({ title, description });
      return;
    } finally {
      setUploading(false);
    }

    const utr = values.utr.replace(/\s+/g, "");
    claim.mutate(
      {
        id: redemptionId,
        proof: { blobName, fileName: values.screenshot.name },
        utr: utr || undefined,
      },
      {
        onSuccess: () => {
          toast.add({ title: "Marked as paid" });
          reset({ screenshot: null, utr: "" });
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <Field data-invalid={errors.screenshot ? true : undefined}>
        <FieldLabel htmlFor="claim-screenshot" required>
          Payment screenshot
        </FieldLabel>
        <input
          ref={fileRef}
          id="claim-screenshot"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-invalid={errors.screenshot ? true : undefined}
          aria-describedby={errors.screenshot ? "claim-screenshot-error" : undefined}
          onChange={(e) => pick(e.target.files)}
        />
        {screenshot && preview ? (
          <div className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-2.5">
            <img
              src={preview}
              alt="Payment screenshot to be attached"
              width={96}
              height={160}
              className="h-40 w-24 shrink-0 rounded-md bg-surface-3 object-contain"
            />
            <div className="min-w-0 flex-1 text-xs text-ink-2">
              <div className="truncate font-medium">{screenshot.name}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1.5 -ml-2"
                disabled={busy}
                onClick={() => setValue("screenshot", null, { shouldValidate: true })}
              >
                <X data-icon="inline-start" aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <ImageUp data-icon="inline-start" aria-hidden />
            Payment screenshot
          </Button>
        )}
        {refusedFile ? (
          <FieldDescription role="alert" className="text-danger">
            Not attached: {refusedFile} — images only, up to{" "}
            {MAX_UPLOAD_BYTES / (1024 * 1024)} MB.
          </FieldDescription>
        ) : null}
        {errors.screenshot ? (
          <FieldDescription
            id="claim-screenshot-error"
            role="alert"
            className="text-danger"
          >
            {errors.screenshot.message}
          </FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={errors.utr ? true : undefined}>
        <FieldLabel htmlFor="claim-utr">UTR / reference (optional)</FieldLabel>
        <Input
          id="claim-utr"
          inputMode="text"
          autoComplete="off"
          placeholder="e.g. 412345678901"
          aria-invalid={errors.utr ? true : undefined}
          aria-describedby={errors.utr ? "claim-utr-error" : undefined}
          className="font-mono"
          {...register("utr")}
        />
        {errors.utr ? (
          <FieldDescription id="claim-utr-error" role="alert" className="text-danger">
            {errors.utr.message}
          </FieldDescription>
        ) : null}
      </Field>

      <Button type="submit" disabled={busy}>
        {busy ? <Spinner data-icon="inline-start" /> : null}
        Mark as paid
      </Button>
    </form>
  );
}

/**
 * An object URL for a picked file, revoked when it changes or unmounts.
 *
 * Derived rather than held in state: the URL is a pure function of the file,
 * and the effect's only job is to give the previous one back to the browser.
 */
function usePreview(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );
  return url;
}
