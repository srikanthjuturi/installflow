import { useCallback, useMemo, useRef, useState } from "react";

/**
 * One way to choose a NON-image file, wherever the console asks for one.
 *
 * A deliberate sibling of `useImagePicker` rather than a generalisation of it.
 * That hook mints an object URL per file, hands back a `PickedImage`, and owns
 * a `release()` because a crop dialog renders what was chosen. A spreadsheet is
 * never rendered — it is posted straight to the server — so there is no URL to
 * mint and nothing to revoke, and bending the image hook to make that optional
 * would complicate the flow every avatar in the app depends on.
 *
 * The two share a shape on purpose: `{ open, inputProps, dropProps, dragging,
 * error }`, click-to-open, drop-to-open, and validation here rather than at the
 * call site so a rejection reads the same everywhere.
 */

interface Options {
  /** `accept` for the input, e.g. ".xlsx,.csv". Also enforced on drop, which
   *  the attribute alone does not cover. */
  accept: string;
  /** Refused above this, client-side, before anything is uploaded. */
  maxBytes: number;
  /** What to call the accepted kinds in an error message, e.g. "spreadsheet". */
  label: string;
  /** Receives the accepted file. Never called with nothing. */
  onFile: (file: File) => void;
}

export function useFilePicker({ accept, maxBytes, label, onFile }: Options) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extensions = useMemo(
    () =>
      accept
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.startsWith(".")),
    [accept]
  );

  const take = useCallback(
    (list: FileList | null) => {
      const file = Array.from(list ?? [])[0];
      if (!file) return;

      // A drop bypasses the input's `accept`, so the extension is checked here
      // too — otherwise dragging a PDF onto the zone reaches the server.
      const name = file.name.toLowerCase();
      if (extensions.length && !extensions.some((ext) => name.endsWith(ext))) {
        setError(`Choose a ${label} — ${extensions.join(" or ")}.`);
        return;
      }
      if (file.size > maxBytes) {
        const mb = Math.round(maxBytes / (1024 * 1024));
        setError(`${file.name} is over ${mb} MB.`);
        return;
      }

      setError(null);
      onFile(file);
    },
    [extensions, label, maxBytes, onFile]
  );

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
        take(e.dataTransfer.files);
      },
    }),
    [take]
  );

  const inputProps = useMemo(
    () => ({
      ref: inputRef,
      type: "file" as const,
      accept,
      className: "sr-only",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        take(e.target.files);
        // Reset so picking the SAME file twice still fires a change event —
        // re-uploading a corrected file with the same name must work.
        e.target.value = "";
      },
    }),
    [accept, take]
  );

  return {
    /** Opens the file explorer. */
    open: useCallback(() => {
      setError(null);
      inputRef.current?.click();
    }, []),
    inputProps,
    dropProps,
    /** True while a file is hovering the target — for the highlight ring. */
    dragging,
    /** A rejection message, or null. Cleared on the next pick. */
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
