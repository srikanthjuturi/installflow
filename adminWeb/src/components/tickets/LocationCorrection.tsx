import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { useCorrectTicketLocation } from "@/hooks/useTickets";
import { formatDateTime } from "@/utils/datetime";
import { isTerminalTicketStatus } from "@/types/ticket";
import type { TicketDetail } from "@/types/ticket";

const SOURCE: Record<NonNullable<TicketDetail["locationSource"]>, string> = {
  customer: "Set by the customer",
  vendor: "Picked by the vendor at intake",
  staff: "Set by staff",
};

/** The same India box the server keeps, so the dialog refuses before Save does. */
const LAT = [6, 38] as const;
const LNG = [68, 98] as const;

/** "17.3850, 78.4867" — what Google Maps copies — into the two numbers. */
function parsePoint(raw: string): { lat: number; lng: number } | null {
  const parts = raw.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [lat, lng] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Where the visit is, and who said so.
 *
 * It says what the point is read from, because it decides how the technician's
 * proof photo is judged and what the travel allowance measures to — and a
 * ticket with no point is judged against its pincode's centre, which is worth
 * saying out loud. Staff can correct it with a reason; the customer's own pin is
 * the usual source, and a wrong one is the usual reason.
 */
export function LocationStrip({
  ticket,
  canCorrect,
}: {
  ticket: TicketDetail;
  canCorrect: boolean;
}) {
  const [open, setOpen] = useState(false);
  const source = ticket.locationSource;
  const finished = isTerminalTicketStatus(ticket.status);

  return (
    <div className="mt-3.5 rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
      <p className="font-semibold text-ink">Visit location</p>
      <p className="mt-1">
        {source
          ? `${SOURCE[source]}${
              ticket.locationSetAt
                ? ` · ${formatDateTime(ticket.locationSetAt)}`
                : ""
            }`
          : "Not set — distance is measured to the pincode's centre."}
      </p>
      {canCorrect && !finished ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 h-7 text-xs"
          onClick={() => setOpen(true)}
        >
          {source ? "Correct location" : "Set location"}
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Unmounts on close, so the form is fresh on every open. */}
        <DialogContent className="sm:max-w-md">
          <CorrectLocationForm ticket={ticket} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

const schema = z.object({
  point: z
    .string()
    .trim()
    .refine((v) => parsePoint(v) !== null, "Enter it as latitude, longitude")
    .refine((v) => {
      const p = parsePoint(v);
      return (
        p === null ||
        (p.lat >= LAT[0] && p.lat <= LAT[1] && p.lng >= LNG[0] && p.lng <= LNG[1])
      );
    }, "That point is outside India"),
  reason: z
    .string()
    .trim()
    .min(1, "Say why — this overrides what the customer chose")
    .max(255, "Keep the note under 255 characters"),
});

type Values = z.infer<typeof schema>;

function CorrectLocationForm({
  ticket,
  onDone,
}: {
  ticket: TicketDetail;
  onDone: () => void;
}) {
  const correct = useCorrectTicketLocation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      point:
        ticket.latitude !== null && ticket.longitude !== null
          ? `${ticket.latitude}, ${ticket.longitude}`
          : "",
      reason: "",
    },
  });

  function submit(values: Values) {
    const p = parsePoint(values.point);
    if (!p) return;
    correct.mutate(
      {
        id: ticket.id,
        latitude: p.lat,
        longitude: p.lng,
        reason: values.reason,
      },
      {
        onSuccess: () => {
          toast.add({
            title: "Location updated",
            description: ticket.technicianName
              ? "The technician already holds this job, so the travel amount stays as it was when they accepted."
              : undefined,
          });
          onDone();
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {ticket.locationSource ? "Correct the location" : "Set the location"}
        </DialogTitle>
        <DialogDescription>
          Where the visit is. The change is recorded in the timeline.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.point ? true : undefined}>
          <FieldLabel htmlFor="location-point" required>
            Latitude, longitude
          </FieldLabel>
          <Input
            id="location-point"
            autoComplete="off"
            placeholder="17.3850, 78.4867"
            aria-invalid={errors.point ? true : undefined}
            {...register("point")}
          />
          <FieldDescription>
            Right-click the spot in Google Maps and click the numbers to copy
            them.
          </FieldDescription>
          {errors.point ? (
            <FieldDescription role="alert" className="text-danger">
              {errors.point.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="location-reason" required>
            Why
          </FieldLabel>
          <Textarea
            id="location-reason"
            rows={2}
            placeholder="e.g. customer rang — the pin was on the wrong street"
            aria-invalid={errors.reason ? true : undefined}
            {...register("reason")}
          />
          {errors.reason ? (
            <FieldDescription role="alert" className="text-danger">
              {errors.reason.message}
            </FieldDescription>
          ) : null}
        </Field>
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={correct.isPending}>
          {correct.isPending ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
