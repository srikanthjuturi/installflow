import { useState } from "react";
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
import { money } from "@/utils/money";

interface NoShowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicianName: string;
  /** RUPEES — the last penalty band, served from Rules configuration. */
  amount: number | null;
  onConfirm: (note: string | null) => void;
  isPending: boolean;
}

/**
 * Confirming that nobody turned up.
 *
 * A dialog rather than a straight button because this is the only control in
 * the console that takes money off a technician, and it takes the most there
 * is. `sweeps.sweep_no_shows` finds these and deliberately charges nothing —
 * a dead phone and a deliberate no-show are indistinguishable in the data — so
 * the whole design rests on a person stopping to decide, and a one-click
 * button would be the same inference with a manager's name on it.
 *
 * The note is optional and asked for anyway: "customer says nobody called" is
 * the difference between a charge somebody can defend three weeks later and
 * one they cannot. Nothing branches on it; it goes onto the trail beside the
 * amount.
 *
 * Net-new — the prototype has no no-show anywhere, because nothing detected
 * one. Every string here needs sign-off.
 */
export function NoShowDialog({
  open,
  onOpenChange,
  technicianName,
  amount,
  onConfirm,
  isPending,
}: NoShowDialogProps) {
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a no-show?</DialogTitle>
          <DialogDescription>
            The slot closed with {technicianName} still assigned and no proof
            captured. Recording a no-show charges the penalty and returns the
            job so it can be rescheduled.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="no-show-note">What happened?</FieldLabel>
          <Input
            id="no-show-note"
            value={note}
            maxLength={255}
            placeholder="Customer says nobody called"
            onChange={(e) => setNote(e.target.value)}
            disabled={isPending}
          />
          <FieldDescription>
            Optional. A short note makes the charge easier to justify later.
          </FieldDescription>
        </Field>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            className="hover:border-danger"
            disabled={isPending}
            onClick={() => onConfirm(note.trim() || null)}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {/* The figure is on the button for the same reason the bonus
                screen puts it there: it cannot be pressed without having been
                read. A dash when the bands have not loaded — never a zero. */}
            Record no-show{amount === null ? "" : ` · ${money(amount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
