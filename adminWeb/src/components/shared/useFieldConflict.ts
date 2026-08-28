import { useCallback, useState } from "react";

import { ApiError } from "@/services/client";

/**
 * A server 409 pinned to the field that caused it.
 *
 * RHF's `setError` cannot hold this. `zodResolver` returns the WHOLE error map
 * on every validation pass, so a manually-set error is wiped by the next one —
 * the same constraint `tickets/ManualEntryForm` documents, and the company
 * dialog validates `onChange`, so there it would not survive a keystroke.
 *
 * Keeping it outside RHF and keyed by the VALUE that was refused means it
 * survives until that value actually changes, which is exactly the moment it
 * stops being true. Retyping the same rejected GSTIN brings it back, because it
 * is still the answer the server gave.
 *
 * It lives in `shared/` with only two consumers — against the usual "wait for a
 * third" rule — because those two sit in different slices (`masters/` and
 * `superadmin/`) and neither can own it.
 *
 * The toast still fires: this does not replace hard rule 9, it says WHERE.
 */
export function useFieldConflict() {
  const [conflict, setConflict] = useState<{
    value: string;
    message: string;
  } | null>(null);

  /** Statutory identifiers are stored upper-case; the live input is raw. */
  const norm = (v: string) => v.trim().toUpperCase();

  /**
   * Record a rejection, but only for the codes this field owns. Anything else
   * — a duplicate name, a taken email, a dead network — is somebody else's
   * message and stays in the toaster alone.
   */
  const capture = useCallback(
    (err: unknown, value: string, codes: readonly string[]) => {
      if (
        err instanceof ApiError &&
        err.code !== undefined &&
        codes.includes(err.code)
      ) {
        setConflict({ value: norm(value), message: err.message });
      }
    },
    []
  );

  /** The message, but only while the field still holds the refused value. */
  const messageFor = useCallback(
    (current: string | undefined) =>
      conflict && norm(current ?? "") === conflict.value
        ? conflict.message
        : undefined,
    [conflict]
  );

  return { capture, messageFor };
}
