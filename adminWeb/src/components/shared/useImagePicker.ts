import { useCallback, useMemo, useRef, useState } from "react";

/**
 * One way to choose an image, wherever the console asks for one.
 *
 * Two entrances, one exit: clicking opens the file explorer, dragging files
 * onto the target does the same thing without it, and both hand the caller the
 * accepted files. Nothing sits in between — no "choose a photo" step inside a
 * dialog that the click had already answered.
 *
 * Validation happens here rather than in each caller because the limits are the
 * server's, not the screen's, and a rejection has to read the same everywhere.
 */

/** What a browser or phone camera produces, and what blob storage accepts. */
export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

/** Refuse a source file that would blow out memory before it is even cropped.
 *  The crop is what gets uploaded, and it is ~50 KB, so this is not the
 *  server's 8 MB ceiling — it is the decode ceiling. */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/**
 * A chosen file and the object URL to render it with.
 *
 * The URL is minted HERE, in the event handler that accepted the file, and
 * released by `release()`. Both are events, which is the point: a blob URL
 * created during render or in an effect is revoked by StrictMode's remount and
 * the image never loads.
 */
export interface PickedImage {
  file: File;
  url: string;
}

interface Options {
  /** Accept more than one file per pick or drop. */
  multiple?: boolean;
  /** Hard cap on how many are taken at once — the rest are refused loudly
   *  rather than silently dropped. */
  max?: number;
  /** Receives the accepted images, in the order chosen. Never called empty. */
  onFiles: (images: PickedImage[]) => void;
}

export function useImagePicker({ multiple = false, max, onFiles }: Options) {
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Frees every URL this picker has handed out. Call when the consumer is
   *  done with them — closing the crop dialog, typically. */
  const release = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);

  const accept = useCallback(
    (list: FileList | null) => {
      const chosen = Array.from(list ?? []);
      if (chosen.length === 0) return;

      const images = chosen.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) {
        setError("Choose an image file — PNG, JPG or WebP.");
        return;
      }
      const oversized = images.find((f) => f.size > MAX_SOURCE_BYTES);
      if (oversized) {
        setError(`${oversized.name} is over 10 MB. Pick a smaller one.`);
        return;
      }

      const room = max ?? images.length;
      if (images.length > room) {
        setError(
          room === 0
            ? "No room for another photo."
            : `Only ${room} more ${room === 1 ? "photo" : "photos"} can be added.`
        );
        return;
      }

      setError(null);
      // The previous batch is finished with by the time a new one is chosen.
      release();
      const taken = multiple ? images : images.slice(0, 1);
      const picked = taken.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      urlsRef.current = picked.map((p) => p.url);
      onFiles(picked);
    },
    [max, multiple, onFiles, release]
  );

  /** Spread onto whatever the user clicks or drops onto. */
  const dropProps = useMemo(
    () => ({
      onDragOver: (e: React.DragEvent) => {
        // Without preventDefault the browser navigates to the dropped file.
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        accept(e.dataTransfer.files);
      },
    }),
    [accept]
  );

  /** Spread onto a visually hidden `<input type="file">` the caller renders. */
  const inputProps = useMemo(
    () => ({
      ref: inputRef,
      type: "file" as const,
      accept: ACCEPTED_IMAGE_TYPES,
      multiple,
      className: "sr-only",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        accept(e.target.files);
        // Reset so picking the SAME file twice still fires a change event —
        // otherwise re-adding a photo you just removed does nothing.
        e.target.value = "";
      },
    }),
    [accept, multiple]
  );

  return {
    /** Opens the file explorer. This is what a camera badge or Add tile does. */
    open: useCallback(() => {
      setError(null);
      inputRef.current?.click();
    }, []),
    inputProps,
    dropProps,
    release,
    /** True while files are hovering the target — for the highlight ring. */
    dragging,
    /** A rejection message, or null. Cleared on the next pick. */
    error,
  };
}
