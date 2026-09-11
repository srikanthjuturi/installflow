import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  useApproveUpiChange,
  useRejectUpiChange,
  useUpiChange,
} from "@/hooks/useTechnicians";
import type { Technician, UpiChange } from "@/types/technician";
import { formatDateTime } from "@/utils/datetime";

/**
 * A technician asking for a new UPI ID — old beside new, and the decision.
 *
 * The technician added their UPI ID themselves with a WhatsApp code; after that
 * only a manager changes it, and this is where. Approving applies it straight
 * away with no code — the manager IS the check. The bell went to the Area
 * Manager for their area (else RH, NH, Admin), but anybody who can edit this
 * technician may decide, so a reviewer who has left never strands a request.
 *
 * Rendered only while `upiChangePending` — the profile says so, and a
 * technician with nothing waiting costs no request at all.
 */
export function UpiChangePanel({
  tech,
  canDecide,
}: {
  tech: Technician;
  canDecide: boolean;
}) {
  const { data: change, isLoading } = useUpiChange(tech.id, {
    enabled: tech.upiChangePending,
  });
  const approve = useApproveUpiChange();
  const [rejecting, setRejecting] = useState(false);

  if (!tech.upiChangePending) return null;
  if (isLoading) return <Skeleton className="h-44 rounded-xl" />;
  if (!change) return null;

  return (
    <Card className="border-warn/40">
      <CardHeader className="border-b">
        <CardTitle className="text-[15px] font-semibold">
          UPI ID change requested
        </CardTitle>
        <CardDescription className="text-xs text-ink-3">
          {tech.name} asked on {formatDateTime(change.requestedAt)} · sent to the{" "}
          {change.reviewerLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 py-1">
        <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Payee label="Now" name={change.oldUpiName} vpa={change.oldUpiId} />
          <ArrowRight className="hidden size-4 text-ink-3 sm:block" aria-hidden />
          <Payee label="Asked for" name={change.newUpiName} vpa={change.newUpiId} strong />
        </div>

        {canDecide ? (
          <div className="flex flex-wrap gap-2.5">
            <Button
              type="button"
              disabled={approve.isPending}
              onClick={() =>
                approve.mutate(tech.id, {
                  onSuccess: () =>
                    toast.add({
                      title: "UPI ID changed",
                      description: `${tech.name}'s earnings now go to ${change.newUpiId}.`,
                    }),
                })
              }
            >
              {approve.isPending ? <Spinner data-icon="inline-start" /> : null}
              Approve change
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={approve.isPending}
              onClick={() => setRejecting(true)}
            >
              Reject
            </Button>
          </div>
        ) : null}
      </CardContent>

      <RejectUpiChangeDialog
        open={rejecting}
        onOpenChange={setRejecting}
        tech={tech}
        change={change}
      />
    </Card>
  );
}

function Payee({
  label,
  name,
  vpa,
  strong,
}: {
  label: string;
  name: string | null;
  vpa: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        {label}
      </div>
      <div className={strong ? "mt-1 font-semibold" : "mt-1 font-medium text-ink-2"}>
        {name ?? "—"}
      </div>
      <div className="font-mono text-xs break-all text-ink-2 select-all">{vpa}</div>
    </div>
  );
}

const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why, so they can fix it")
    .max(160, "Keep the reason under 160 characters"),
});

type RejectValues = z.infer<typeof rejectSchema>;

function RejectUpiChangeDialog({
  open,
  onOpenChange,
  tech,
  change,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tech: Technician;
  change: UpiChange;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <RejectForm tech={tech} change={change} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({
  tech,
  change,
  onDone,
}: {
  tech: Technician;
  change: UpiChange;
  onDone: () => void;
}) {
  const reject = useRejectUpiChange();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });

  return (
    <form
      onSubmit={handleSubmit((values) =>
        reject.mutate(
          { id: tech.id, reason: values.reason },
          {
            // Closed from `onSuccess`, never on click — a 409 (decided or
            // withdrawn meanwhile) leaves the dialog standing over the toast.
            onSuccess: () => {
              toast.add({ title: "Change rejected" });
              onDone();
            },
          }
        )
      )}
      noValidate
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Reject the change to {change.newUpiId}?</DialogTitle>
        <DialogDescription>
          {tech.name} keeps {change.oldUpiId} and reads your reason.
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={errors.reason ? true : undefined}>
        <FieldLabel htmlFor="upi-reject-reason" required>
          Reason
        </FieldLabel>
        <Textarea
          id="upi-reject-reason"
          rows={3}
          autoFocus
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? "upi-reject-reason-error" : undefined}
          {...register("reason")}
        />
        {errors.reason ? (
          <FieldDescription
            id="upi-reject-reason-error"
            role="alert"
            className="text-danger"
          >
            {errors.reason.message}
          </FieldDescription>
        ) : null}
      </Field>
      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={reject.isPending}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" variant="destructive" disabled={reject.isPending}>
          {reject.isPending ? <Spinner /> : null}
          Reject
        </Button>
      </DialogFooter>
    </form>
  );
}
