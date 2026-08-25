import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCorrectTicketSerial } from "@/hooks/useTickets";
import type { TicketDetail } from "@/types/ticket";

const HOW: Record<string, string> = {
  scanned: "scanned off the barcode",
  manual: "typed from the label",
};

/**
 * The serial on the unit was not the serial on the order.
 *
 * Recorded rather than enforced — the technician has already done the physical
 * work, and the likeliest cause is a slip at intake rather than the wrong unit
 * being installed. So this is a thing to resolve, not a wall: it states both
 * numbers and offers the one correction that is ever right, which is to the
 * ORDER.
 *
 * The vendor sees this banner too, and they are the party who can usually
 * settle it: they hold the invoice the number was copied from.
 */
export function SerialMismatchBanner({ ticket }: { ticket: TicketDetail }) {
  const [open, setOpen] = useState(false);

  if (!ticket.serialMismatch) return null;

  const how = ticket.observedSerialSource
    ? HOW[ticket.observedSerialSource]
    : null;

  return (
    <>
      <div
        role="alert"
        className="mt-4 flex flex-wrap items-start gap-3 rounded-md border border-danger/35 bg-danger-bg px-3.5 py-3"
      >
        <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-danger">
            Serial mismatch
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">
            The technician read{" "}
            <b className="font-semibold text-ink">{ticket.observedSerial}</b> on
            site{how ? ` (${how})` : null}. The order says{" "}
            <b className="font-semibold text-ink">
              {ticket.serialNumber ?? "nothing"}
            </b>
            .
          </p>
          <p className="mt-1 text-xs text-ink-3">
            If the order is wrong, correct it here. What the technician read is
            evidence and is not editable.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-danger/40 bg-surface text-danger hover:bg-danger-bg"
          onClick={() => setOpen(true)}
        >
          Correct the order serial
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Unmounts on close, so the form is fresh on every open. */}
        <DialogContent className="sm:max-w-md">
          {open ? (
            <CorrectSerialForm ticket={ticket} onDone={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

const schema = z.object({
  serialNumber: z
    .string()
    .trim()
    .min(1, "Enter the serial from the invoice")
    .max(64, "Serials are at most 64 characters"),
  reason: z.string().trim().max(255, "Keep the note under 255 characters"),
});

type Values = z.infer<typeof schema>;

function CorrectSerialForm({
  ticket,
  onDone,
}: {
  ticket: TicketDetail;
  onDone: () => void;
}) {
  const correct = useCorrectTicketSerial();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    // Prefilled with what was READ, not with what the order says: the whole
    // reason this form is open is that the order's number is the suspect one,
    // and the technician's reading is the evidence of what is actually there.
    defaultValues: { serialNumber: ticket.observedSerial ?? "", reason: "" },
  });

  function submit(values: Values) {
    correct.mutate(
      {
        id: ticket.id,
        serialNumber: values.serialNumber,
        reason: values.reason || null,
      },
      {
        onSuccess: (saved) => {
          toast.add({
            title: "Serial corrected",
            description: saved.serialMismatch
              ? `The order now reads ${saved.serialNumber}, which still differs from what was read on site.`
              : `The order now reads ${saved.serialNumber}. It matches what the technician read.`,
          });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Correct the expected serial</DialogTitle>
        <DialogDescription>
          The number this order was raised with — off the invoice. Correcting it
          is recorded with both values and who changed them.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.serialNumber ? true : undefined}>
          <FieldLabel htmlFor="serial-value">Expected serial</FieldLabel>
          <Input
            id="serial-value"
            autoComplete="off"
            aria-invalid={errors.serialNumber ? true : undefined}
            aria-describedby={
              errors.serialNumber ? "serial-value-error" : "serial-value-hint"
            }
            {...register("serialNumber")}
          />
          <FieldDescription id="serial-value-hint">
            Currently {ticket.serialNumber ?? "empty"} · read on site as{" "}
            {ticket.observedSerial}
          </FieldDescription>
          {errors.serialNumber ? (
            <FieldDescription
              id="serial-value-error"
              role="alert"
              className="text-danger"
            >
              {errors.serialNumber.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="serial-reason">Why (optional)</FieldLabel>
          <Textarea
            id="serial-reason"
            rows={2}
            placeholder="e.g. invoice says 88417 — mistyped at intake"
            aria-invalid={errors.reason ? true : undefined}
            {...register("reason")}
          />
          <FieldDescription>
            Goes into the ticket's trail. A bare number never explains itself
            later.
          </FieldDescription>
        </Field>
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={correct.isPending}>
          {correct.isPending ? <Spinner /> : null}
          Save correction
        </Button>
      </DialogFooter>
    </form>
  );
}
