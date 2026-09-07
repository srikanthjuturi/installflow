import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { Info } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useRescheduleSlots } from "@/hooks/useTickets";
import { describeSlot } from "@/utils/slots";
import {
  rescheduleResolver,
  type RescheduleFormValues,
} from "./ticketSchema";

/**
 * Give a ticket a new time, after agreeing one with the customer.
 *
 * ⚠ **NET-NEW. Every string here needs sign-off.** The approved prototype has
 * no reschedule anywhere and says the opposite where it touches the subject —
 * "Slot confirmed & locked", and "The confirmed slot … stays locked" on the
 * bonus screen. Same convention as `NoShowDialog`, which carries the same note
 * for the same reason.
 *
 * ## Why there is no code here
 *
 * The technician's own door in the mobile app sends the customer six digits and
 * makes them read them back, because a technician moving a customer's time
 * unilaterally is exactly what must not happen. A manager has already spoken to
 * the customer — asking them to also relay a code would be ceremony rather than
 * evidence. The required reason is what stands in its place, and it is the only
 * record that the call happened.
 *
 * ## Where the windows come from
 *
 * `GET /tickets/:id/reschedule/slots`, never the local `offeredSlots`. That one
 * stops at the service level, which a ticket being re-slotted has usually blown
 * — the browser would show an empty menu on precisely the tickets this dialog
 * is for. The server also subtracts what the assigned technician is booked for
 * and the days their cap is spent, which no browser can know.
 */
export function RescheduleDialog({
  open,
  onOpenChange,
  ticketId,
  currentSlot,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  /** What it is booked for now, already formatted. `null` when nothing is. */
  currentSlot: string | null;
  onConfirm: (values: RescheduleFormValues) => void;
  isPending: boolean;
}) {
  const { data, isPending: loadingSlots } = useRescheduleSlots(ticketId, open);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RescheduleFormValues>({
    resolver: rescheduleResolver,
    defaultValues: { slotStart: "", reason: "" },
  });

  // A dialog that keeps the last ticket's answer is a dialog that books the
  // wrong window on the second use.
  useEffect(() => {
    if (open) reset({ slotStart: "", reason: "" });
  }, [open, reset]);

  const days = useMemo(() => {
    const byDay = new Map<string, { start: string; time: string }[]>();
    for (const raw of data ?? []) {
      const slot = describeSlot(raw.slotStart, raw.slotEnd);
      const list = byDay.get(slot.day);
      if (list) list.push({ start: slot.start, time: slot.time });
      else byDay.set(slot.day, [{ start: slot.start, time: slot.time }]);
    }
    return [...byDay.entries()];
  }, [data]);

  const err = (name: keyof RescheduleFormValues) => errors[name]?.message;
  const noWindows = !loadingSlots && days.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change the time?</DialogTitle>
          <DialogDescription>
            {currentSlot
              ? `This visit is booked for ${currentSlot}. Agree a new window with the customer first — they will be sent a WhatsApp naming both times.`
              : "No time has been agreed yet. Set one here, and the customer will be sent a WhatsApp confirming it."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onConfirm)}
          className="flex flex-col gap-4"
          noValidate
        >
          {loadingSlots ? (
            <div className="flex items-center gap-2.5 py-2 text-xs text-ink-2">
              <Spinner className="size-4" />
              Finding available windows…
            </div>
          ) : noWindows ? (
            <p className="flex items-start gap-2.5 rounded-md bg-warn-bg px-3.5 py-3 text-xs leading-relaxed text-warn">
              <Info className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                There is no free window in the next two days. If a technician is
                assigned, their days are full — re-assign the job to somebody
                else and the windows will open up.
              </span>
            </p>
          ) : (
            <Field data-invalid={err("slotStart") ? true : undefined}>
              <FieldLabel htmlFor="reschedule-slot">New window</FieldLabel>
              <Controller
                control={control}
                name="slotStart"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="reschedule-slot"
                      className="w-full"
                      aria-invalid={err("slotStart") ? true : undefined}
                      aria-describedby={
                        err("slotStart") ? "reschedule-slot-error" : undefined
                      }
                    >
                      <SelectValue placeholder="Pick a window" />
                    </SelectTrigger>
                    <SelectContent>
                      {days.map(([day, windows]) => (
                        <SelectGroup key={day}>
                          <SelectLabel>{day}</SelectLabel>
                          {windows.map((w) => (
                            <SelectItem key={w.start} value={w.start}>
                              {w.time}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {err("slotStart") ? (
                <FieldDescription
                  id="reschedule-slot-error"
                  role="alert"
                  className="text-danger"
                >
                  {err("slotStart")}
                </FieldDescription>
              ) : null}
            </Field>
          )}

          <Field data-invalid={err("reason") ? true : undefined}>
            <FieldLabel htmlFor="reschedule-reason">
              Why is it moving?
            </FieldLabel>
            <Input
              id="reschedule-reason"
              placeholder="Customer asked for Thursday morning"
              aria-invalid={err("reason") ? true : undefined}
              aria-describedby="reschedule-reason-hint"
              {...register("reason")}
            />
            <FieldDescription
              id="reschedule-reason-hint"
              role={err("reason") ? "alert" : undefined}
              className={err("reason") ? "text-danger" : undefined}
            >
              {err("reason") ??
                "Required. Nobody else was on the call, so this is the only record of it."}
            </FieldDescription>
          </Field>

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button type="submit" disabled={isPending || noWindows}>
              {isPending ? <Spinner className="size-4" /> : null}
              Change the time
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
