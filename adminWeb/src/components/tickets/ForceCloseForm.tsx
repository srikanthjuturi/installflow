import { useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Paperclip, TriangleAlert, X } from "lucide-react";
import { z } from "zod";
import { LinkButton } from "@/components/shared/LinkButton";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import type { NavOrigin } from "@/hooks/useNavOrigin";
import { MAX_UPLOAD_BYTES } from "@/services/uploads";
import { cn } from "@/lib/utils";

/** The three approved bases for a manager closure (§10). */
const REASONS = [
  "Customer unreachable after multiple attempts",
  "Customer confirmed verbally, unable to close in app",
  "Customer declined to respond within window",
] as const;

/**
 * What blob storage takes. Mirrors `ALLOWED_CONTENT_TYPES` in
 * `api/app/integrations/blob.py` — refused there too, so this only saves the
 * round trip and gives the reason in the reader's own words.
 */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const ACCEPTED_TYPES = ACCEPT.split(",");

/**
 * Attachments are the whole point of this screen: §10 requires supporting
 * documents and images, and records who closed the ticket, when and on what
 * basis. The API rejects an empty list with a 422 — this schema stops it ever
 * getting that far.
 *
 * The field holds real `File` objects, not names. It used to hold `file.name`
 * strings, which meant the form collected evidence and then threw the bytes
 * away: what reached the (unimplemented) service was a list of filenames. They
 * are uploaded on submit, and what the API stores is the blob name each upload
 * returns.
 */
const forceCloseSchema = z.object({
  reason: z.string().min(1, "Select a reason for force-closure"),
  notes: z
    .string()
    .trim()
    .min(10, "Describe the attempts made — the note is kept for audit"),
  attachments: z
    .array(z.instanceof(File))
    .min(1, "At least one supporting document or image is required")
    .max(10, "Ten attachments is the most this records"),
});

export type ForceCloseFormValues = z.infer<typeof forceCloseSchema>;

interface ForceCloseFormProps {
  ticketId: string;
  onSubmit: (values: ForceCloseFormValues) => void;
  isSubmitting: boolean;
  /**
   * The trail to hand back to the ticket that Cancel returns to, so abandoning
   * a force-close does not also lose the queue or the ledger behind it.
   */
  cancelState?: NavOrigin;
}

export function ForceCloseForm({
  ticketId,
  onSubmit,
  isSubmitting,
  cancelState,
}: ForceCloseFormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  /** Files the picker refused, named so nothing disappears silently. */
  const [rejected, setRejected] = useState<string[]>([]);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ForceCloseFormValues>({
    resolver: zodResolver(forceCloseSchema),
    defaultValues: { reason: "", notes: "", attachments: [] },
  });

  const attachments = useWatch({ control, name: "attachments" });

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const ok = picked.filter(
      (f) => ACCEPTED_TYPES.includes(f.type) && f.size <= MAX_UPLOAD_BYTES
    );
    // Named rather than dropped. A file that vanishes on selection reads as a
    // bug, and the manager would submit believing they had attached it.
    setRejected(
      picked.filter((f) => !ok.includes(f)).map((f) => f.name)
    );

    // De-duped on name AND size, so picking the same file twice adds it once
    // while two genuinely different files called "photo.jpg" both survive.
    const seen = new Set(attachments.map((f) => `${f.name}:${f.size}`));
    const added = ok.filter((f) => !seen.has(`${f.name}:${f.size}`));
    setValue("attachments", [...attachments, ...added], {
      shouldValidate: true,
    });
    // Let the same file be picked again after it is removed.
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeFile = (file: File) =>
    setValue(
      "attachments",
      attachments.filter((a) => a !== file),
      { shouldValidate: true }
    );

  const err = (name: keyof ForceCloseFormValues) => errors[name]?.message;

  return (
    /* A justification note is long-form prose, so this column gets a reading
       width. The page around it stays fluid. */
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-3xl">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-[15px] font-semibold">
            Force-close ticket · <span className="font-mono">{ticketId}</span>
          </CardTitle>
          <CardDescription className="text-xs text-ink-3">
            Only after the customer wait period has elapsed. Supporting
            documents &amp; images are mandatory and recorded for audit.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5 py-1">
          {/* This used to read "Customer has not responded for 52 hours (wait
              period: 48h). Verification already passed." — three numbers and a
              claim, none of them measured. It came from the prototype, where
              every screen had one ticket's invented figures baked in.

              Neither figure is knowable here: the silence would have to be
              measured from the ticket's own `feedback_requested` event, and
              nothing on this page reads it. So the banner says what force
              closure IS, which needs no data to be true, and the wait period
              lives where it is actually configured — Rules Config. */}
          <p className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            This closes the job without the customer&apos;s confirmation. It
            cannot be undone, and your name, the reason and these attachments
            are recorded on the ticket.
          </p>

          <FieldSet>
            <FieldLegend
              variant="label"
              required
              className="text-[13px] font-medium"
            >
              Reason for force-closure
            </FieldLegend>
            <Controller
              name="reason"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-invalid={err("reason") ? true : undefined}
                  aria-describedby={
                    err("reason") ? "force-close-reason-error" : undefined
                  }
                  className="grid gap-2.5"
                >
                  {REASONS.map((reason) => (
                    <label
                      key={reason}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3 text-[13px] transition-colors",
                        field.value === reason
                          ? "border-brand-500 bg-brand-100/40"
                          : "border-line hover:border-brand-400"
                      )}
                    >
                      <RadioGroupItem value={reason} />
                      <span>{reason}</span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            />
            {err("reason") ? (
              <FieldDescription
                id="force-close-reason-error"
                role="alert"
                className="text-danger"
              >
                {err("reason")}
              </FieldDescription>
            ) : null}
          </FieldSet>

          <FieldGroup className="gap-5">
            <Field data-invalid={err("notes") ? true : undefined}>
              <FieldLabel htmlFor="force-close-notes" required>
                Justification notes
              </FieldLabel>
              <textarea
                id="force-close-notes"
                rows={4}
                placeholder="Describe the attempts made to reach the customer and the basis for closure…"
                aria-invalid={err("notes") ? true : undefined}
                aria-describedby={
                  err("notes") ? "force-close-notes-error" : undefined
                }
                className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
                {...register("notes")}
              />
              {err("notes") ? (
                <FieldDescription
                  id="force-close-notes-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("notes")}
                </FieldDescription>
              ) : null}
            </Field>

            <Field data-invalid={err("attachments") ? true : undefined}>
              <FieldLabel htmlFor="force-close-files">
                Supporting attachments (required)
              </FieldLabel>
              <div className="rounded-md border-2 border-dashed border-line bg-surface-2 px-5 py-5 text-center">
                <p className="text-[13px] text-ink-2">
                  Attach call logs, signed acknowledgment, or on-site photos
                </p>
                {/* Photograph a document rather than scanning it: blob storage
                    takes images only, and the same rule refuses an .html or
                    .svg that would be a stored-XSS vector on our own domain. */}
                <p className="mt-1 text-xs text-ink-3">
                  JPG, PNG, WEBP or HEIC · up to{" "}
                  {MAX_UPLOAD_BYTES / (1024 * 1024)} MB each
                </p>
                <input
                  ref={fileRef}
                  id="force-close-files"
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="sr-only"
                  aria-invalid={err("attachments") ? true : undefined}
                  aria-describedby={
                    err("attachments") ? "force-close-files-error" : undefined
                  }
                  onChange={(e) => addFiles(e.target.files)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2.5"
                  disabled={isSubmitting}
                  onClick={() => fileRef.current?.click()}
                >
                  Choose files
                </Button>
              </div>

              {attachments.length ? (
                <ul className="flex flex-wrap gap-2">
                  {attachments.map((file) => (
                    <li
                      key={`${file.name}:${file.size}`}
                      className="flex items-center gap-1.5 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs font-medium text-ink-2"
                    >
                      <Paperclip className="size-3.5 shrink-0" aria-hidden />
                      {file.name}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${file.name}`}
                        disabled={isSubmitting}
                        onClick={() => removeFile(file)}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* A refusal has to be visible. Silently dropping a PDF the
                  manager believed they had attached is the one failure that
                  would send them away thinking the evidence was recorded. */}
              {rejected.length ? (
                <FieldDescription role="alert" className="text-danger">
                  Not attached: {rejected.join(", ")} — images only, up to{" "}
                  {MAX_UPLOAD_BYTES / (1024 * 1024)} MB each.
                </FieldDescription>
              ) : null}

              {err("attachments") ? (
                <FieldDescription
                  id="force-close-files-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("attachments")}
                </FieldDescription>
              ) : null}
            </Field>
          </FieldGroup>
        </CardContent>

        {/* Irreversible: the ticket lands on Force-Closed and the closure is
            written to the audit trail. The tint never carries that alone —
            the icon and the verb do too. */}
        <CardFooter className="justify-end gap-2.5 bg-danger-bg/40">
          {/* The ticket, not wherever Back goes: cancelling abandons this form
              and the ticket is what the reader was last looking at. */}
          <LinkButton
            variant="outline"
            to={`/tickets/${ticketId}`}
            state={cancelState}
          >
            Cancel
          </LinkButton>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger/30"
          >
            {isSubmitting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <TriangleAlert data-icon="inline-start" aria-hidden />
            )}
            Force-close ticket
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
