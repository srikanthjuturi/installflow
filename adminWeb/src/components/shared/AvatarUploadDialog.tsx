import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { ImagePlus, ZoomIn, ZoomOut } from "lucide-react";
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
import { getCroppedImage } from "@/utils/cropImage";

/** Refuse anything that would blow out memory or isn't a picture at all. */
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED = "image/png,image/jpeg,image/webp";

interface AvatarUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the cropped square as a data URL. */
  onSave: (dataUrl: string) => void;
}

/**
 * Pick a photo, drag and zoom to frame it inside a circle, save the crop.
 *
 * The crop is done in the browser with `react-easy-crop`; there is no upload
 * endpoint yet, so `onSave` hands back a data URL the caller persists in the
 * session store. Selecting a new file while one is already loaded just swaps
 * it — the object URL of the old one is revoked so it does not leak.
 */
export function AvatarUploadDialog({
  open,
  onOpenChange,
  onSave,
}: AvatarUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Free the object URL when the picked file changes or the dialog unmounts.
  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  // A closed dialog keeps nothing — reopening always starts at "choose a
  // photo". Resetting here (an event callback, not an effect) is why closing
  // by Cancel, Esc, the backdrop or a successful save all land in the same
  // clean state.
  function handleOpenChange(next: boolean) {
    if (!next) {
      releaseObjectUrl();
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixels(null);
      setError(null);
      setSaving(false);
    }
    onOpenChange(next);
  }

  function onPick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file — PNG, JPG or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That image is over 10 MB. Pick a smaller one.");
      return;
    }
    releaseObjectUrl();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setError(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setPixels(null);
    setImageSrc(url);
  }

  async function handleSave() {
    if (!imageSrc || !pixels) return;
    setSaving(true);
    try {
      const dataUrl = await getCroppedImage(imageSrc, pixels);
      onSave(dataUrl);
      handleOpenChange(false);
    } catch {
      setError("Could not process that image. Try a different one.");
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile photo</DialogTitle>
          <DialogDescription>
            Drag to reposition and zoom to frame your face inside the circle.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0])}
        />

        {imageSrc ? (
          <div className="space-y-3">
            {/* react-easy-crop fills this box absolutely, so it needs a height. */}
            <div className="relative h-64 overflow-hidden rounded-lg bg-ink">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, croppedAreaPixels) =>
                  setPixels(croppedAreaPixels)
                }
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

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus data-icon="inline-start" />
              Choose a different photo
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-64 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line bg-surface-2 text-ink-3 transition-colors hover:border-brand-400 hover:text-brand-400"
          >
            <ImagePlus className="size-8" aria-hidden />
            <span className="text-sm font-medium">Choose a photo</span>
            <span className="text-xs">PNG, JPG or WebP · up to 10 MB</span>
          </button>
        )}

        {error ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!pixels || saving}
          >
            {saving ? "Saving…" : "Save photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
