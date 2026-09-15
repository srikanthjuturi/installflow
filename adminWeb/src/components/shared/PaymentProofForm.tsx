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
import { describeError } from "@/lib/apiError";
import { MAX_UPLOAD_BYTES, uploadImage } from "@/services/uploads";

/** What blob storage takes — mirrors `ALLOWED_CONTENT_TYPES` in the API. */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const ACCEPTED_TYPES = ACCEPT.split(",");

/** The server's own rule for a UTR, after dropping spaces. */
const UTR = /^[A-Za-z0-9]{6,35}$/;
const UTR_SHAPE =
  "Enter the UTR as it appears in your UPI app — letters and digits, 6 to 35 of them";

function proofSchema(utrRequired: boolean) {
  return z.object({
    screenshot: z
      .instanceof(File)
      .nullable()
      // An explicit `boolean` return: TypeScript would otherwise infer
      // `f !== null` as a type predicate, narrowing the OUTPUT to `File` while
      // the form's default stays `null` — two types for one field, and RHF
      // refuses the pair.
      .refine((f): boolean => f !== null, "Attach the payment screenshot"),
    utr: z
      .string()
      .trim()
      .refine((v) => !utrRequired || v !== "", "Enter the UTR / reference ID from your UPI app")
      .refine((v) => v === "" || UTR.test(v.replace(/\s+/g, "")), UTR_SHAPE),
  });
}

type ProofFormValues = z.infer<ReturnType<typeof proofSchema>>;

export interface PaymentProof {
  proof: { blobName: string; fileName: string };
  /** Spaces dropped; empty when none was given and none was required. */
  utr: string;
}

/**
 * "I paid", with the screenshot that shows it — and the UTR, optional or not.
 *
 * Shared by the two places money is claimed paid by UPI with no gateway: a
 * payer paying a technician's redemption (UTR optional — see `ClaimPaymentForm`)
 * and a company paying the platform for credits (UTR required — the platform
 * matches it against its own statement).
 *
 * One file, and no crop dialog — the force-close exception, for its reason:
 * cropping evidence removes the thing it was attached to prove. A preview is
 * shown instead, because the likeliest mistake is picking the wrong screenshot
 * out of a gallery full of them.
 *
 * Upload first, then claim — never the other way round, or a claim would be
 * recorded pointing at a file that never arrived. The upload is a bare call, so
 * its failure is toasted here; the claim's own failure is the global mutation
 * handler's, which is why `onSubmit`'s rejection is swallowed rather than
 * toasted twice.
 */
export function PaymentProofForm({
  idPrefix,
  utrRequired,
  utrLabel,
  submitLabel,
  pending,
  onSubmit,
}: {
  /** Keeps two forms on one page from sharing element ids. */
  idPrefix: string;
  utrRequired: boolean;
  utrLabel: string;
  submitLabel: string;
  /** The claim itself is in flight. */
  pending: boolean;
  /** Resolve to clear the form; reject to keep what was entered. */
  onSubmit: (proof: PaymentProof) => Promise<unknown>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [refusedFile, setRefusedFile] = useState<string | null>(null);
  const schema = useMemo(() => proofSchema(utrRequired), [utrRequired]);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ProofFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { screenshot: null, utr: "" },
  });

  const screenshot = useWatch({ control, name: "screenshot" });
  const preview = usePreview(screenshot);
  const busy = uploading || pending;
  const ids = {
    screenshot: `${idPrefix}-screenshot`,
    utr: `${idPrefix}-utr`,
  };

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

  async function submit(values: ProofFormValues) {
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

    try {
      await onSubmit({
        proof: { blobName, fileName: values.screenshot.name },
        utr: values.utr.replace(/\s+/g, ""),
      });
      reset({ screenshot: null, utr: "" });
    } catch {
      // Reported by the global mutation handler; keep what was entered.
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <Field data-invalid={errors.screenshot ? true : undefined}>
        <FieldLabel htmlFor={ids.screenshot} required>
          Payment screenshot
        </FieldLabel>
        <input
          ref={fileRef}
          id={ids.screenshot}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-invalid={errors.screenshot ? true : undefined}
          aria-describedby={errors.screenshot ? `${ids.screenshot}-error` : undefined}
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
            id={`${ids.screenshot}-error`}
            role="alert"
            className="text-danger"
          >
            {errors.screenshot.message}
          </FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={errors.utr ? true : undefined}>
        <FieldLabel htmlFor={ids.utr} required={utrRequired}>
          {utrLabel}
        </FieldLabel>
        <Input
          id={ids.utr}
          inputMode="text"
          autoComplete="off"
          placeholder="e.g. 412345678901"
          aria-invalid={errors.utr ? true : undefined}
          aria-describedby={errors.utr ? `${ids.utr}-error` : undefined}
          className="font-mono"
          {...register("utr")}
        />
        {errors.utr ? (
          <FieldDescription id={`${ids.utr}-error`} role="alert" className="text-danger">
            {errors.utr.message}
          </FieldDescription>
        ) : null}
      </Field>

      <Button type="submit" disabled={busy}>
        {busy ? <Spinner data-icon="inline-start" /> : null}
        {submitLabel}
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
