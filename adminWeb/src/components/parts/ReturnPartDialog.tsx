import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { ImageUp, X } from "lucide-react";
import {
  useImagePicker,
  type PickedImage,
} from "@/components/shared/useImagePicker";
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
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/apiError";
import { MAX_UPLOAD_BYTES, uploadImage } from "@/services/uploads";
import type { PartRequest } from "@/types/parts";
import { noteResolver, type NoteValues } from "./partSchemas";

/**
 * Log the old part coming back — Task 13 §5.7. An optional note and **one
 * optional photo**.
 *
 * The photo skips the crop dialog: the force-close / `PaymentProofForm`
 * evidence exception. Cropping evidence removes the thing it was attached to
 * prove. `useImagePicker` still owns the click, the drop and the validation, so
 * a rejection reads like every other upload here.
 *
 * **Upload first, then log** — never the other way round, or a return would be
 * recorded pointing at a file that never arrived (`ForceClosePage`'s order). An
 * upload failure toasts and keeps this dialog open with the file still chosen;
 * the return's own failure is the global mutation handler's.
 *
 * The page owns the mutation and closes this on success only.
 */
export function ReturnPartDialog({
  open,
  onOpenChange,
  request,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: PartRequest;
  onConfirm: (values: { note: string; photoBlobName: string | null }) => void;
  isPending: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NoteValues>({
    resolver: noteResolver,
    defaultValues: { note: "" },
  });

  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const [uploading, setUploading] = useState(false);

  const picker = useImagePicker({
    onFiles: (images) => {
      const next = images[0] ?? null;
      setTooBig(!!next && next.file.size > MAX_UPLOAD_BYTES);
      setPhoto(next);
    },
  });
  const { release } = picker;

  // Mounted by the page only while open, so a note or photo never outlives the
  // request it was chosen for. The object URL is released with the dialog.
  useEffect(() => release, [release]);

  const busy = uploading || isPending;
  const err = errors.note?.message;

  async function submit(values: NoteValues) {
    let blobName: string | null = null;
    if (photo) {
      setUploading(true);
      try {
        blobName = await uploadImage(photo.file, "attachment");
      } catch (e) {
        const { title, description } = describeError(
          e,
          "Couldn't upload the photo"
        );
        toast.add({ title, description });
        // Nothing is logged and the dialog stays open with the file chosen.
        return;
      } finally {
        setUploading(false);
      }
    }
    onConfirm({ note: values.note, photoBlobName: blobName });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log the old part back · {request.partName}</DialogTitle>
          <DialogDescription>
            From {request.technicianName} on {request.ticketCode}.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(submit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field data-invalid={err ? true : undefined}>
            <FieldLabel htmlFor="return-part-note">Note (optional)</FieldLabel>
            <Input
              id="return-part-note"
              maxLength={500}
              autoComplete="off"
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? "return-part-note-error" : undefined}
              disabled={busy}
              {...register("note")}
            />
            {err ? (
              <FieldDescription
                id="return-part-note-error"
                role="alert"
                className="text-danger"
              >
                {err}
              </FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={picker.error || tooBig ? true : undefined}>
            <FieldLabel htmlFor="return-part-photo">Photo (optional)</FieldLabel>
            <input id="return-part-photo" {...picker.inputProps} />
            {photo ? (
              <div className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-2.5">
                <img
                  src={photo.url}
                  alt="Photo of the old part to be attached"
                  width={96}
                  height={96}
                  className="size-24 shrink-0 rounded-md bg-surface-3 object-contain"
                />
                <div className="min-w-0 flex-1 text-xs text-ink-2">
                  <div className="truncate font-medium">{photo.file.name}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1.5 -ml-2"
                    disabled={busy}
                    onClick={() => {
                      picker.release();
                      setPhoto(null);
                      setTooBig(false);
                    }}
                  >
                    <X data-icon="inline-start" aria-hidden />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              // Click opens the picker; a drop does the same — one flow.
              <div
                {...picker.dropProps}
                className={cn(
                  "rounded-md border border-dashed border-line p-3",
                  picker.dragging && "ring-2 ring-brand-500"
                )}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={picker.open}
                >
                  <ImageUp data-icon="inline-start" aria-hidden />
                  Add a photo
                </Button>
              </div>
            )}
            <FieldDescription
              role={picker.error || tooBig ? "alert" : undefined}
              className={picker.error || tooBig ? "text-danger" : undefined}
            >
              {picker.error ??
                (tooBig
                  ? "That photo is over 8 MB. Pick a smaller one."
                  : "JPG, PNG or WEBP · up to 8 MB")}
            </FieldDescription>
          </Field>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={busy || tooBig}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Log return
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
