import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Check } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useCorrectTicketReading,
  useCorrectTicketSerial,
  useTicketProof,
  useTicketSerialCheck,
} from "@/hooks/useTickets";
import type { TicketDetail } from "@/types/ticket";

const HOW: Record<string, string> = {
  scanned: "scanned off the barcode",
  manual: "typed from the label",
};

function howRead(ticket: TicketDetail): string | null {
  return ticket.observedSerialSource
    ? (HOW[ticket.observedSerialSource] ?? null)
    : null;
}

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
 *
 * The banner and the dialog name the two numbers the same way — "on the order"
 * and "read on site" — because three names for one number is what made the
 * first version of this hard to follow.
 *
 * The OTHER slip — the order is right and the technician typed it wrong — had
 * no way out: the right number was already the order's (nothing to save) and
 * the wrong one was refused by the serial list. `canCorrectReading` adds the
 * second correction, to the reading, for an Area Manager and above. Never the
 * vendor: it edits evidence, so it needs a manager, a reason and the photo.
 */
export function SerialMismatchBanner({
  ticket,
  canCorrectReading = false,
}: {
  ticket: TicketDetail;
  canCorrectReading?: boolean;
}) {
  const [open, setOpen] = useState<"order" | "reading" | null>(null);

  if (!ticket.serialMismatch) return null;

  const how = howRead(ticket);

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
          <p className="mt-1 text-xs leading-relaxed break-all text-ink-2">
            On the order:{" "}
            <b className="font-semibold text-ink">
              {ticket.serialNumber ?? "nothing"}
            </b>
            {" · "}Read on site:{" "}
            <b className="font-semibold text-ink">{ticket.observedSerial}</b>
            {how ? ` (${how})` : null}
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {canCorrectReading
              ? "If the order has the wrong number, correct the order. If the technician typed it wrong, check their photo and correct the reading."
              : "If the order has the wrong number, correct it. If the technician typed it wrong, an Area Manager can correct their reading."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-danger/40 bg-surface text-danger hover:bg-danger-bg"
            onClick={() => setOpen("order")}
          >
            Correct the order serial
          </Button>
          {canCorrectReading ? (
            <Button
              variant="outline"
              size="sm"
              className="border-danger/40 bg-surface text-danger hover:bg-danger-bg"
              onClick={() => setOpen("reading")}
            >
              Correct the technician's reading
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        {/* Unmounts on close, so the form is fresh on every open. */}
        <DialogContent className="sm:max-w-md">
          {open === "order" ? (
            <CorrectSerialForm ticket={ticket} onDone={() => setOpen(null)} />
          ) : open === "reading" ? (
            <CorrectReadingForm ticket={ticket} onDone={() => setOpen(null)} />
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
  const current = ticket.serialNumber ?? "";
  const read = ticket.observedSerial ?? "";
  const how = howRead(ticket);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    // The order's CURRENT number, so reopening after a save shows what was
    // saved. It used to start with the technician's reading, and a box that
    // never showed the saved value read as a save that had been lost. The
    // reading is one click away instead — see "Use …" below.
    defaultValues: { serialNumber: current, reason: "" },
  });

  // The server's two rules, restated so the dialog says what Save will do
  // before it is pressed. Unchanged is EXACT, because that is when
  // `correct_serial` writes nothing; a match is case-insensitive, because that
  // is how `serialMismatch` compares.
  const typed = (useWatch({ control, name: "serialNumber" }) ?? "").trim();
  const unchanged = typed === current;
  const matchesRead =
    typed !== "" && typed.toUpperCase() === read.trim().toUpperCase();

  // The third rule is the product's serial list, and only the server holds
  // it — so it is asked, not restated. It matters most for the "Use …"
  // button: the number the technician read is the one nobody loaded. An answer
  // counts only while it is about what is in the box NOW.
  const settled = useDebouncedValue(typed);
  const check = useTicketSerialCheck(
    ticket.id,
    settled,
    settled !== "" && settled !== current
  );
  const refusal =
    settled === typed && check.data && !check.data.accepted
      ? check.data.message
      : null;

  function fillReading() {
    setValue("serialNumber", read, { shouldValidate: true, shouldDirty: true });
  }

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
        <DialogTitle>Correct the order serial</DialogTitle>
        <DialogDescription>
          Fix the number this order was raised with. The change is recorded in
          the timeline.
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-line-2 bg-surface-2 px-3.5 py-3 text-[13px]">
        <dt className="text-ink-3">On the order now</dt>
        <dd className="font-semibold break-all text-ink">{current || "—"}</dd>
        <dt className="text-ink-3">Read on site</dt>
        <dd className="break-all text-ink">
          <span className="font-semibold">{read}</span>
          {how ? <span className="text-ink-3"> ({how})</span> : null}
        </dd>
      </dl>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.serialNumber ? true : undefined}>
          <FieldLabel htmlFor="serial-value" required>
            New serial for the order
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              id="serial-value"
              autoComplete="off"
              className="min-w-0 flex-1"
              aria-invalid={errors.serialNumber ? true : undefined}
              aria-describedby={
                errors.serialNumber
                  ? "serial-value-error"
                  : typed
                    ? "serial-value-hint"
                    : undefined
              }
              {...register("serialNumber")}
            />
            {/* The usual fix: the order was mistyped and the unit is right. */}
            {read && !matchesRead ? (
              <Button
                type="button"
                variant="outline"
                className="max-w-1/2"
                onClick={fillReading}
              >
                <span className="truncate">Use {read}</span>
              </Button>
            ) : null}
          </div>
          {typed === "" ? null : unchanged ? (
            <FieldDescription id="serial-value-hint" className="text-ink-3">
              This is already the order's serial.
            </FieldDescription>
          ) : refusal ? (
            // The server's own sentence — the one Save would refuse with.
            <FieldDescription
              id="serial-value-hint"
              className="flex items-start gap-1.5 text-danger"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="break-all">{refusal}</span>
            </FieldDescription>
          ) : matchesRead ? (
            <FieldDescription
              id="serial-value-hint"
              className="flex items-start gap-1.5 text-ok"
            >
              <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Matches what the technician read. The warning will go away.
            </FieldDescription>
          ) : (
            <FieldDescription
              id="serial-value-hint"
              className="flex items-start gap-1.5 text-warn"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="break-all">
                Still different from what the technician read ({read}). The
                warning will stay.
              </span>
            </FieldDescription>
          )}
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
        {/* Disabled while unchanged: the server writes nothing then, and a
            "Serial corrected" toast for a save that changed nothing is the
            confusion this dialog was rewritten to remove. And while refused,
            with the reason on screen — Save could only fail. While the check
            is still out it stays enabled; the PATCH runs the same rule. */}
        <Button
          type="submit"
          disabled={correct.isPending || unchanged || refusal !== null}
        >
          {correct.isPending ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

const readingSchema = z.object({
  observedSerial: z
    .string()
    .trim()
    .min(1, "Enter the serial shown in the photo")
    .max(64, "Serials are at most 64 characters"),
  reason: z
    .string()
    .trim()
    .min(1, "Say why — this changes what the technician recorded")
    .max(255, "Keep the note under 255 characters"),
});

type ReadingValues = z.infer<typeof readingSchema>;

/**
 * Correcting what the technician TYPED, for when the order was right.
 *
 * The photo is the point of this dialog: the typed value was only a
 * transcription of it, so the manager reads the real number off the picture
 * rather than taking anybody's word. A scanned serial has no serial photo —
 * the barcode step stands in for it — so that one is shown instead.
 *
 * No serial-list check here, unlike the order dialog: a reading says what is
 * on the unit, and a unit the list does not know is exactly what a mismatch is
 * for. The reason is required because this edits evidence.
 */
function CorrectReadingForm({
  ticket,
  onDone,
}: {
  ticket: TicketDetail;
  onDone: () => void;
}) {
  const correct = useCorrectTicketReading();
  const order = ticket.serialNumber ?? "";
  const current = ticket.observedSerial ?? "";
  const how = howRead(ticket);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<ReadingValues>({
    resolver: zodResolver(readingSchema),
    defaultValues: { observedSerial: current, reason: "" },
  });

  // Same two rules as the order dialog, pointed the other way: unchanged is
  // EXACT (the server writes nothing), a match is case-insensitive (how
  // `serialMismatch` compares).
  const typed = (useWatch({ control, name: "observedSerial" }) ?? "").trim();
  const unchanged = typed === current;
  const matchesOrder =
    typed !== "" && typed.toUpperCase() === order.trim().toUpperCase();

  function fillOrder() {
    setValue("observedSerial", order, {
      shouldValidate: true,
      shouldDirty: true,
    });
  }

  function submit(values: ReadingValues) {
    correct.mutate(
      {
        id: ticket.id,
        observedSerial: values.observedSerial,
        reason: values.reason,
      },
      {
        onSuccess: (saved) => {
          toast.add({
            title: "Reading corrected",
            description: saved.serialMismatch
              ? `The reading is now ${saved.observedSerial}, which still differs from the order.`
              : `The reading is now ${saved.observedSerial}. It matches the order.`,
          });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Correct the technician's reading</DialogTitle>
        <DialogDescription>
          Use this when the order is right and the technician typed the serial
          wrong. Read the real number off their photo. The old reading stays in
          the timeline.
        </DialogDescription>
      </DialogHeader>

      <ReadingPhoto ticket={ticket} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-line-2 bg-surface-2 px-3.5 py-3 text-[13px]">
        <dt className="text-ink-3">On the order</dt>
        <dd className="font-semibold break-all text-ink">{order || "—"}</dd>
        <dt className="text-ink-3">Read on site now</dt>
        <dd className="break-all text-ink">
          <span className="font-semibold">{current}</span>
          {how ? <span className="text-ink-3"> ({how})</span> : null}
        </dd>
      </dl>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.observedSerial ? true : undefined}>
          <FieldLabel htmlFor="reading-value" required>
            Correct reading
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              id="reading-value"
              autoComplete="off"
              className="min-w-0 flex-1"
              aria-invalid={errors.observedSerial ? true : undefined}
              aria-describedby={
                errors.observedSerial
                  ? "reading-value-error"
                  : typed
                    ? "reading-value-hint"
                    : undefined
              }
              {...register("observedSerial")}
            />
            {/* The usual fix: the technician mistyped and the order is right. */}
            {order && !matchesOrder ? (
              <Button
                type="button"
                variant="outline"
                className="max-w-1/2"
                onClick={fillOrder}
              >
                <span className="truncate">Use {order}</span>
              </Button>
            ) : null}
          </div>
          {typed === "" ? null : unchanged ? (
            <FieldDescription id="reading-value-hint" className="text-ink-3">
              This is already the reading.
            </FieldDescription>
          ) : matchesOrder ? (
            <FieldDescription
              id="reading-value-hint"
              className="flex items-start gap-1.5 text-ok"
            >
              <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Matches the order. The warning will go away.
            </FieldDescription>
          ) : (
            <FieldDescription
              id="reading-value-hint"
              className="flex items-start gap-1.5 text-warn"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="break-all">
                Still different from the order ({order}). The warning will stay.
              </span>
            </FieldDescription>
          )}
          {errors.observedSerial ? (
            <FieldDescription
              id="reading-value-error"
              role="alert"
              className="text-danger"
            >
              {errors.observedSerial.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="reading-reason" required>
            Why
          </FieldLabel>
          <Textarea
            id="reading-reason"
            rows={2}
            placeholder="e.g. photo shows 400097-2210 — technician typed 2210"
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? "reading-reason-error" : undefined}
            {...register("reason")}
          />
          {errors.reason ? (
            <FieldDescription
              id="reading-reason-error"
              role="alert"
              className="text-danger"
            >
              {errors.reason.message}
            </FieldDescription>
          ) : (
            <FieldDescription>
              Goes into the ticket's trail beside the old reading.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={correct.isPending || unchanged}>
          {correct.isPending ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The picture the reading should have been copied from. The serial photo when
 * the technician typed it; the barcode photo when it was scanned, because a
 * scanned serial skips the serial step.
 */
function ReadingPhoto({ ticket }: { ticket: TicketDetail }) {
  const [failed, setFailed] = useState(false);
  const { data, isLoading, isError } = useTicketProof(ticket.id);
  const kind = ticket.observedSerialSource === "scanned" ? "barcode" : "serial";
  const label = kind === "barcode" ? "Barcode photo" : "Serial photo";
  const shot = data?.find((p) => p.kind === kind);

  if (isLoading) return <Skeleton className="aspect-4/3 w-full rounded-md" />;

  if (isError || !shot?.url || failed) {
    return (
      <p className="rounded-md bg-surface-3 px-3.5 py-3 text-xs text-ink-2">
        {isError
          ? "Couldn't load the photo. It is also in Proof of completion on this page."
          : `No ${label.toLowerCase()} is available for this ticket.`}
      </p>
    );
  }

  return (
    <a
      href={shot.url}
      target="_blank"
      rel="noreferrer"
      className="group relative block overflow-hidden rounded-md bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
    >
      <img
        src={shot.url}
        alt={label}
        onError={() => setFailed(true)}
        className="max-h-64 w-full object-contain"
      />
      {/* Over the photograph, so it needs its own ground — as on ProofThumb. */}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
        {label} · opens full size
      </span>
    </a>
  );
}
