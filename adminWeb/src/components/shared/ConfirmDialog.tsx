import type { ReactNode } from "react";

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

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the target, so the reader can see WHICH row they are about to act on. */
  title: string;
  /** The consequence, and how to undo it. */
  description: ReactNode;
  /** The verb — "Suspend user", "Delete company". Never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  cancelLabel?: string;
  /** Optional field between the description and the footer — a note, a reason. */
  children?: ReactNode;
}

/**
 * The one confirmation for every destructive action in the console — a delete,
 * a removal, a suspension. Nothing that deletes or suspends may fire on a
 * single click.
 *
 * Two behaviours are load-bearing and easy to undo by accident:
 *
 * - **It does not close itself on confirm.** The caller closes in the
 *   mutation's `onSuccess`, so a failure leaves the dialog standing over the
 *   toast rather than dismissing as though it had worked.
 * - **A backdrop click does not dismiss it** — inherited from `Dialog`'s
 *   `disablePointerDismissal` default. Escape and Cancel are the ways out.
 *
 * There is no inline error slot on purpose: every API failure surfaces in the
 * toaster via the global handlers in `App.tsx` (hard rule 9). Name the action
 * with `meta: { errorTitle }` on the mutation instead.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending = false,
  cancelLabel = "Cancel",
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {children}

        {/* The failure is reported in the toaster (App.tsx), not here. */}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {cancelLabel}
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
