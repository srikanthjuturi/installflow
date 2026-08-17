import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ImageCropDialog } from "@/components/shared/ImageCropDialog";
import {
  useImagePicker,
  type PickedImage,
} from "@/components/shared/useImagePicker";
import { uploadImage } from "@/services/uploads";
import { cn } from "@/lib/utils";

interface AvatarPickerProps {
  /** Drives the initials fallback and the button's accessible name. */
  name: string;
  /** Current picture as a stored URL, or `null` for the initials fallback. */
  value: string | null;
  /** Called with the uploaded photo's URL, or `null` when it is removed. */
  onChange: (value: string | null) => void;
  /** Box + text size for the disc, e.g. `size-14 text-lg`. */
  avatarClassName?: string;
  /** Names the person in the button label — "Change {label} photo". */
  label?: string;
}

/**
 * The reusable "set a profile photo" control: the avatar, a camera badge, and
 * the crop dialog they open.
 *
 * The badge opens the file explorer directly, and the disc itself accepts a
 * dropped image — either way the crop dialog appears with the photo already
 * loaded. The crop is uploaded to blob storage here, so `onChange` receives a
 * URL the server can store, never a data URL: a base64 avatar is tens of
 * kilobytes inside a TEXT column that rides along in every list response naming
 * that person. Upload failures surface inside the dialog, which stays open
 * holding the crop, so the parent form never carries an error state for a
 * photo. Removal is left to the caller — a one-line `onChange(null)` placed
 * wherever that screen's layout wants it.
 */
export function AvatarPicker({
  name,
  value,
  onChange,
  avatarClassName,
  label = "profile",
}: AvatarPickerProps) {
  const [images, setImages] = useState<PickedImage[]>([]);
  const picker = useImagePicker({ onFiles: setImages });

  return (
    <div className="relative shrink-0">
      <input {...picker.inputProps} />

      {/* The disc is the drop target — the obvious place to aim a dragged
          photo, and big enough to hit. */}
      <div
        {...picker.dropProps}
        className={cn(
          "rounded-full ring-offset-2 ring-offset-card transition-shadow",
          picker.dragging && "ring-2 ring-brand-500"
        )}
      >
        <UserAvatar name={name} src={value} className={avatarClassName} />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="icon-xs"
        onClick={picker.open}
        aria-label={value ? `Change ${label} photo` : `Add ${label} photo`}
        className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-card"
      >
        <Camera />
      </Button>

      {picker.error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {picker.error}
        </p>
      ) : null}

      <ImageCropDialog
        images={images}
        onClose={() => {
          setImages([]);
          picker.release();
        }}
        title="Profile photo"
        description="Drag to reposition and zoom to frame the face inside the circle."
        cropShape="round"
        onSave={async (blob) => onChange(await uploadImage(blob, "profile"))}
      />
    </div>
  );
}
