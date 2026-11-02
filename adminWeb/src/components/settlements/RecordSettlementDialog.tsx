import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Paperclip, X } from "lucide-react";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useRecordSettlement } from "@/hooks/useFranchiseSettlements";
import { describeError } from "@/lib/apiError";
import { MAX_UPLOAD_BYTES, uploadImage } from "@/services/uploads";
import {
  SETTLEMENT_REASONS,
  SETTLEMENT_REASON_LABELS,
  rupeesToPaise,
  type SettlementFranchisee,
  type SettlementReason,
  type SettlementSide,
} from "@/types/franchiseSettlement";
import { moneyPaise } from "@/utils/money";
import {
  isoDay,
  oldestAllowedDay,
  recordSettlementSchema,
  type RecordSettlementValues,
} from "./recordSettlementSchema";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";

/**
 * "I sent this money" — the company recording a transfer to a franchisee (staff)
 * or a franchisee recording one to the company (portal). One dialog, because the
 * fields are the same; only the franchisee select and the wording differ.
 *
 * The screenshot is mandatory and goes up FIRST, then the record carries its
 * blob name — never the other way round, or a record would point at a file that
 * never arrived. The record then waits for the OTHER side to confirm; the sender
 * cannot.
 */
export function RecordSettlementDialog({
  side,
  open,
  onOpenChange,
  franchisees,
}: {
  side: SettlementSide;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Staff only. */
  franchisees?: SettlementFranchisee[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <RecordForm
            side={side}
            franchisees={franchisees ?? []}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecordForm({
  side,
  franchisees,
  onDone,
}: {
  side: SettlementSide;
  franchisees: SettlementFranchisee[];
  onDone: () => void;
}) {
  const staff = side === "staff";
  const record = useRecordSettlement(side);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [today] = useState(() => new Date());
  const schema = useMemo(
    () => recordSettlementSchema({ needsFranchisee: staff, today }),
    [staff, today]
  );

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RecordSettlementValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      franchiseeId: "",
      amount: undefined,
      reason: "lease",
      note: "",
      transferredOn: isoDay(today),
      utr: "",
      screenshot: null,
    },
  });

  const franchiseeId = useWatch({ control, name: "franchiseeId" }) ?? "";
  const reason = (useWatch({ control, name: "reason" }) ?? "lease") as SettlementReason;
  const screenshot = useWatch({ control, name: "screenshot" });
  const busy = uploading || record.isPending;

  async function submit(values: RecordSettlementValues) {
    if (!values.screenshot) return;
    setUploading(true);
    let blobName: string;
    try {
      blobName = await uploadImage(values.screenshot, "attachment");
    } catch (err) {
      const { title, description } = describeError(
        err,
        "Couldn't upload the screenshot"
      );
      toast.add({ title, description });
      return;
    } finally {
      setUploading(false);
    }

    const utr = values.utr.replace(/\s+/g, "");
    record.mutate(
      {
        ...(staff ? { franchiseeId: values.franchiseeId } : {}),
        amountPaise: rupeesToPaise(values.amount),
        reason: values.reason as SettlementReason,
        ...(values.note ? { note: values.note } : {}),
        transferredOn: values.transferredOn,
        ...(utr ? { utr } : {}),
        proof: { blobName, fileName: values.screenshot.name },
      },
      // Closed from `onSuccess` only — a refusal leaves the dialog standing over
      // the toast, with what was typed.
      {
        onSuccess: (saved) => {
          toast.add({
            title: `${moneyPaise(saved.amountPaise)} recorded`,
            description: staff
              ? `${saved.franchiseeName} will be asked to confirm it arrived.`
              : "The company will be asked to confirm it arrived.",
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
          {staff ? "Record transfer to franchisee" : "Record transfer to company"}
        </DialogTitle>
        <DialogDescription>
          {staff
            ? "Money you sent a franchisee. They confirm it arrived — it counts only once they do."
            : "Money you sent the company. The company confirms it arrived — it counts only once they do."}
        </DialogDescription>
      </DialogHeader>

      {staff ? (
        <Field data-invalid={errors.franchiseeId ? true : undefined}>
          <FieldLabel htmlFor="settle-franchisee" required>
            Franchisee
          </FieldLabel>
          <Select
            value={franchiseeId}
            onValueChange={(v) =>
              v &&
              setValue("franchiseeId", v, { shouldValidate: true, shouldDirty: true })
            }
          >
            <SelectTrigger id="settle-franchisee">
              <SelectValue placeholder="Pick a franchisee">
                {(v: string) => franchisees.find((f) => f.id === v)?.name ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {franchisees.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.franchiseeId ? (
            <FieldDescription role="alert" className="text-danger">
              {errors.franchiseeId.message}
            </FieldDescription>
          ) : (
            <FieldDescription>
              The home franchisee is the company itself, so it is not listed.
            </FieldDescription>
          )}
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor="settle-amount" required>
            Amount (₹)
          </FieldLabel>
          <Input
            id="settle-amount"
            type="number"
            inputMode="decimal"
            min={0.01}
            step="0.01"
            autoFocus
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? "settle-amount-error" : undefined}
            {...register("amount", { valueAsNumber: true })}
          />
          {errors.amount ? (
            <FieldDescription
              id="settle-amount-error"
              role="alert"
              className="text-danger"
            >
              {errors.amount.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="settle-reason" required>
            What it was for
          </FieldLabel>
          <Select
            value={reason}
            onValueChange={(v) =>
              v && setValue("reason", v, { shouldValidate: true, shouldDirty: true })
            }
          >
            <SelectTrigger id="settle-reason">
              <SelectValue>
                {(v: SettlementReason) => SETTLEMENT_REASON_LABELS[v] ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SETTLEMENT_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {SETTLEMENT_REASON_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.reason ? (
            <FieldDescription role="alert" className="text-danger">
              {errors.reason.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.transferredOn ? true : undefined}>
          <FieldLabel htmlFor="settle-date" required>
            Day it was sent
          </FieldLabel>
          <Input
            id="settle-date"
            type="date"
            min={oldestAllowedDay(today)}
            max={isoDay(today)}
            aria-invalid={errors.transferredOn ? true : undefined}
            aria-describedby={errors.transferredOn ? "settle-date-error" : undefined}
            {...register("transferredOn")}
          />
          {errors.transferredOn ? (
            <FieldDescription
              id="settle-date-error"
              role="alert"
              className="text-danger"
            >
              {errors.transferredOn.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.utr ? true : undefined}>
          <FieldLabel htmlFor="settle-utr">UTR / reference</FieldLabel>
          <Input
            id="settle-utr"
            autoComplete="off"
            className="font-mono"
            placeholder="e.g. 412345678901"
            aria-invalid={errors.utr ? true : undefined}
            aria-describedby={errors.utr ? "settle-utr-error" : undefined}
            {...register("utr")}
          />
          {errors.utr ? (
            <FieldDescription id="settle-utr-error" role="alert" className="text-danger">
              {errors.utr.message}
            </FieldDescription>
          ) : (
            <FieldDescription>Optional — as the bank prints it.</FieldDescription>
          )}
        </Field>
      </div>

      <Field data-invalid={errors.note ? true : undefined}>
        <FieldLabel htmlFor="settle-note" required={reason === "other"}>
          Note
        </FieldLabel>
        <Textarea
          id="settle-note"
          rows={2}
          placeholder="e.g. October lease"
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? "settle-note-error" : undefined}
          {...register("note")}
        />
        {errors.note ? (
          <FieldDescription id="settle-note-error" role="alert" className="text-danger">
            {errors.note.message}
          </FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={errors.screenshot ? true : undefined}>
        <FieldLabel htmlFor="settle-file" required>
          Payment screenshot
        </FieldLabel>
        <input
          ref={fileRef}
          id="settle-file"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            if (fileRef.current) fileRef.current.value = "";
            if (!picked) return;
            if (
              !ACCEPT.split(",").includes(picked.type) ||
              picked.size > MAX_UPLOAD_BYTES
            ) {
              toast.add({
                title: `${picked.name} was not attached`,
                description: `Images only, up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
              });
              return;
            }
            setValue("screenshot", picked, { shouldValidate: true });
          }}
        />
        {screenshot ? (
          <div className="flex items-center gap-2 text-[13px]">
            <Paperclip className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span className="truncate">{screenshot.name}</span>
            <button
              type="button"
              className="ml-auto rounded p-1 text-ink-3 hover:text-ink"
              aria-label={`Remove ${screenshot.name}`}
              disabled={busy}
              onClick={() => setValue("screenshot", null, { shouldValidate: true })}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip data-icon="inline-start" />
            Attach screenshot
          </Button>
        )}
        {errors.screenshot ? (
          <FieldDescription role="alert" className="text-danger">
            {errors.screenshot.message}
          </FieldDescription>
        ) : null}
      </Field>

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline" disabled={busy}>
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          Record transfer
        </Button>
      </DialogFooter>
    </form>
  );
}
