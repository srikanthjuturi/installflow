import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { AvatarUploadDialog } from "@/components/shared/AvatarUploadDialog";

interface AvatarPickerProps {
  /** Drives the initials fallback and the button's accessible name. */
  name: string;
  /** Current picture as a data URL, or `null` for the initials fallback. */
  value: string | null;
  /** Called with the cropped data URL, or `null` when the picture is removed. */
  onChange: (value: string | null) => void;
  /** Box + text size for the disc, e.g. `size-14 text-lg`. */
  avatarClassName?: string;
  /** Names the person in the button label — "Change {label} photo". */
  label?: string;
}

/**
 * The reusable "set a profile photo" control: the avatar with a camera badge
 * anchored to its corner, and the crop dialog it opens. Picking, framing and
 * saving all happen here; the parent owns only the resulting data URL. The
 * account card and the technician form both render this, so setting a photo
 * feels identical wherever it happens. Removal is left to the caller — it is a
 * one-line `onChange(null)` placed wherever that screen's layout wants it.
 */
export function AvatarPicker({
  name,
  value,
  onChange,
  avatarClassName,
  label = "profile",
}: AvatarPickerProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="relative shrink-0">
      <UserAvatar name={name} src={value} className={avatarClassName} />
      <Button
        type="button"
        variant="secondary"
        size="icon-xs"
        onClick={() => setEditing(true)}
        aria-label={value ? `Change ${label} photo` : `Add ${label} photo`}
        className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-card"
      >
        <Camera />
      </Button>
      <AvatarUploadDialog
        open={editing}
        onOpenChange={setEditing}
        onSave={onChange}
      />
    </div>
  );
}
