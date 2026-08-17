import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { ZoomIn, ZoomOut } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { DEFAULT_OUTPUT_SIZE, getCroppedBlob } from "@/utils/cropImage";
import type { PickedImage } from "@/components/shared/useImagePicker";

interface ImageCropDialogProps {
  /**
   * The images to crop, in order, straight from `useImagePicker`. Non-empty
   * means open — the file explorer has already been answered by the time this
   * renders, so there is no picking step here. Crop one, and the next takes its
   * place. The picker owns their object URLs; this only reads them.
   */
  images: PickedImage[];
  /** Called when the queue is finished, cancelled or dismissed. Release the
   *  picker's URLs here. */
  onClose: () => void;
  title: string;
  description: string;
  /** Crop box shape, width ÷ height. 1 (the default) is a square. */
  aspect?: number;
  cropShape?: "round" | "rect";
  /** Width of the exported image in pixels; height follows `aspect`. */
  outputSize?: number;
  saveLabel?: string;
  /**
   * Receives each cropped image. May be async — the dialog shows a busy state
   * until it settles, moves to the next file on success, and stays open showing
   * the thrown message on failure, so a failed upload never loses the crop.
   */
  onSave: (blob: Blob) => void | Promise<void>;
}

/**
 * Frame an image and save it. Opens straight onto the picture.
 *
 * Choosing the file happens before this — a camera badge, an Add tile or a drop
 * opens the file explorer, and this appears with the result already loaded.
 * That is the whole flow: click, choose, crop, save.
 *
 * A multi-file pick is cropped one at a time in place ("Photo 2 of 3"), because
 * every photo needs its own framing and a grid of thumbnail-sized croppers
 * would give none of them enough room.
 */
export function ImageCropDialog({
  images,
  onClose,
  title,
  description,
  aspect = 1,
  cropShape = "rect",
  outputSize = DEFAULT_OUTPUT_SIZE,
  saveLabel = "Save photo",
  onSave,
}: ImageCropDialogProps) {
  const [index, setIndex] = useState(0);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = images[index];

  function close() {
    setIndex(0);
    setPixels(null);
    setError(null);
    setSaving(false);
    onClose();
  }

  async function handleSave() {
    if (!pixels || !current) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(current.url, pixels, {
        width: outputSize,
        height: outputSize / aspect,
      });
      await onSave(blob);
      setSaving(false);
      // Saved photos stay saved: a later failure in the same batch does not
      // undo them, it stops the queue where it is.
      if (index + 1 < images.length) {
        setIndex(index + 1);
        setPixels(null);
      } else {
        close();
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not process that image. Try a different one."
      );
      setSaving(false);
    }
  }

  const position =
    images.length > 1 ? `Photo ${index + 1} of ${images.length}` : null;

  return (
    <Dialog open={images.length > 0} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {position ? `${position} — ${description}` : description}
          </DialogDescription>
        </DialogHeader>

        {/* Keyed by position in the queue, so each photo starts unframed:
            carrying the previous one's pan and zoom would crop this one
            somewhere the user never chose. */}
        {current ? (
          <CropStage
            key={index}
            src={current.url}
            aspect={aspect}
            cropShape={cropShape}
            onCrop={setPixels}
          />
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="button" onClick={handleSave} disabled={!pixels || saving}>
            {saving ? <Spinner data-icon="inline-start" /> : null}
            {saving ? "Saving…" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One photo's cropper. Mounted per photo, which is what resets pan and zoom —
 * a remount does it for free, where an effect watching the file would be a
 * cascading render.
 */
function CropStage({
  src,
  aspect,
  cropShape,
  onCrop,
}: {
  src: string;
  aspect: number;
  cropShape: "round" | "rect";
  onCrop: (crop: Area) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  return (
    <div className="space-y-3">
      {/* react-easy-crop fills this box absolutely, so it needs a height. */}
      <div className="relative h-64 overflow-hidden rounded-lg bg-ink">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={cropShape}
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, croppedAreaPixels) => onCrop(croppedAreaPixels)}
        />
      </div>

      <div className="flex items-center gap-3">
        <ZoomOut className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          aria-label="Zoom"
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand-500"
        />
        <ZoomIn className="size-4 shrink-0 text-ink-3" aria-hidden />
      </div>
    </div>
  );
}
