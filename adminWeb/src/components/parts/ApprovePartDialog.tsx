import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { PartRequest } from "@/types/parts";
import { offersAddToCatalogue } from "./partStatus";

/**
 * Approve a request (Task 13 §5.7). Names the part and the ticket so the reader
 * can see WHICH request they are about to say yes to.
 *
 * An *Other* request still waiting offers *Add "{name}" to {category}'s parts
 * list* (P7) — one click creates the catalogue row on the ticket's leaf node and
 * links the request. **Unticked by default**: adding to a catalogue every
 * technician on every product beneath it reads is deliberate, never a side
 * effect of approving one job's part.
 *
 * Mounted by the page only while open (so the tick always starts clear —
 * a dialog that kept the last request's tick would add the wrong name). The
 * page owns the mutation and closes this on success
 * only, so a refusal (two tabs, a 409) is reported by the toaster over a dialog
 * that is still standing.
 */
export function ApprovePartDialog({
  open,
  onOpenChange,
  request,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: PartRequest;
  onConfirm: (values: { addToCatalogue: boolean }) => void;
  isPending: boolean;
}) {
  const [add, setAdd] = useState(false);

  const target = request.catalogueTarget;
  const offer = offersAddToCatalogue(request) && target !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Approve {request.partName} for {request.ticketCode}?
          </DialogTitle>
          <DialogDescription>
            {request.technicianName} is told it&apos;s approved.
          </DialogDescription>
        </DialogHeader>

        {offer ? (
          <label className="flex items-start gap-2.5 text-[13px]">
            <Checkbox
              checked={add}
              onCheckedChange={(next) => setAdd(next === true)}
              disabled={isPending}
              className="mt-0.5"
            />
            <span className="text-ink">
              Add &quot;{request.partName}&quot; to {target.nodeName}&apos;s
              parts list
            </span>
          </label>
        ) : null}

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            type="button"
            disabled={isPending}
            onClick={() => onConfirm({ addToCatalogue: offer && add })}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
