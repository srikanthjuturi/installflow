import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Paperclip, X } from "lucide-react";
import { z } from "zod";
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
import { useRecordVendorPayment } from "@/hooks/useVendorCredits";
import { describeError } from "@/lib/apiError";
import { MAX_UPLOAD_BYTES, uploadImage } from "@/services/uploads";
import { VENDOR_PAYMENT_METHODS } from "@/types/vendorCredit";
import type { VendorStanding } from "@/types/vendorCredit";
import { moneyPaise } from "@/utils/money";

/** One crore in rupees — `rules.LIMITS["vendor_credit_limit_paise"]`'s ceiling. */
const MAX_RUPEES = 10_000_000;

const schema = z.object({
  amount: z
    .number({ error: "Enter the amount that arrived" })
    .min(0.01, "At least ₹0.01")
    // Two decimals, compared with a tolerance: `3200.5 * 100` is
    // 320050.00000000006 in binary floating point, so an exact test would refuse
    // a figure typed correctly.
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
      "Use at most two decimal places"
    )
    .max(MAX_RUPEES, "At most ₹1,00,00,000"),
  method: z.string().min(2, "Pick how the money arrived"),
  receivedOn: z.string().min(1, "Enter the day it arrived"),
  reference: z
    .string()
    .trim()
    .max(35, "Keep the reference under 35 characters")
    .refine(
      (v) => v === "" || /^[A-Za-z0-9]+$/.test(v),
      "Letters and digits only — as your bank prints it"
    ),
  note: z.string().trim().max(255, "Keep the note under 255 characters"),
});

type Values = z.infer<typeof schema>;

/**
 * Writing down money that reached the company by some route other than the QR.
 *
 * ## Why this exists
 *
 * The QR flow only covers UPI, and UPI caps one transfer at ₹1,00,000. Without
 * this, a vendor settling ₹5,00,000 by RTGS — which is how most B2B settlement
 * here actually moves — had no way to have it credited, and neither did a cheque
 * or cash. The only remedies were to redo it as five QR payments, or to raise
 * their limit, which records a credit decision in place of a payment.
 *
 * ## It is one person's word, and the dialog says so
 *
 * Every other action here needs two people. This one cannot: a bank statement is
 * the only evidence such a payment leaves on our side, and the vendor — who has
 * told nobody — is not a second observer waiting to be asked. The row is marked
 * `source: "staff"` so the trail never confuses it with a claim the vendor made,
 * and the copy below is blunt about it being final.
 */
export function RecordPaymentDialog({
  vendor,
  onOpenChange,
}: {
  vendor: VendorStanding | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={vendor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {vendor ? (
          <RecordForm vendor={vendor} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecordForm({
  vendor,
  onDone,
}: {
  vendor: VendorStanding;
  onDone: () => void;
}) {
  const record = useRecordVendorPayment();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const owed = Math.max(0, vendor.usedPaise);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      // Prefilled with what is owed, because clearing a balance is the common
      // case — but freely editable both ways: a part payment is normal, and an
      // advance is a real thing a vendor does.
      amount: owed > 0 ? owed / 100 : 0.01,
      method: "NEFT",
      // Today, as the likeliest answer. It is still a choice: a Friday transfer
      // noticed on Monday is three days apart, and the statement is ordered by
      // the day it arrived.
      receivedOn: new Date().toISOString().slice(0, 10),
      reference: "",
      note: "",
    },
  });

  // `useWatch`, not `watch()` — the house pattern (`ForceCloseForm`), and the one
  // the lint rule accepts: `watch()` cannot be memoized safely.
  // Defaulted on read: `useWatch` is typed as possibly absent on the first
  // render, and the Select below takes a string rather than a maybe-string.
  const method = useWatch({ control, name: "method" }) ?? "NEFT";
  const amount = useWatch({ control, name: "amount" }) ?? 0;
  const overpaying = Number.isFinite(amount) && Math.round(amount * 100) > owed;

  async function submit(values: Values) {
    let proof: { blobName: string; fileName: string } | undefined;
    if (file) {
      setUploading(true);
      try {
        // Upload first, then record — never the other way round, or the payment
        // would point at a file that never arrived.
        proof = { blobName: await uploadImage(file, "attachment"), fileName: file.name };
      } catch (err) {
        const { title, description } = describeError(
          err,
          "Couldn't upload the attachment"
        );
        toast.add({ title, description });
        return;
      } finally {
        setUploading(false);
      }
    }
    record.mutate(
      {
        vendorId: vendor.vendorId,
        amountPaise: Math.round(values.amount * 100),
        method: values.method,
        receivedOn: values.receivedOn,
        ...(values.reference ? { reference: values.reference } : {}),
        ...(values.note ? { note: values.note } : {}),
        ...(proof ? { proof } : {}),
      },
      // Closed from `onSuccess` only — a 409 (that reference is already
      // credited) has to leave the dialog standing over the toast.
      {
        onSuccess: (saved) => {
          toast.add({
            title: `${moneyPaise(saved.amountPaise)} recorded`,
            description: `${vendor.vendorName} can raise tickets again.`,
          });
          onDone();
        },
      }
    );
  }

  const busy = uploading || record.isPending;

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Record a payment</DialogTitle>
        <DialogDescription>
          Money {vendor.vendorName} sent you by NEFT, RTGS, cheque or cash — not
          through the QR. {owed > 0 ? `They owe ${moneyPaise(owed)}.` : "They owe nothing."}{" "}
          Recording it restores their limit straight away and can&apos;t be undone.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor="record-amount" required>
            Amount (₹)
          </FieldLabel>
          <Input
            id="record-amount"
            type="number"
            inputMode="decimal"
            min={0.01}
            step="0.01"
            autoFocus
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={
              errors.amount ? "record-amount-error" : "record-amount-hint"
            }
            {...register("amount", { valueAsNumber: true })}
          />
          {errors.amount ? (
            <FieldDescription
              id="record-amount-error"
              role="alert"
              className="text-danger"
            >
              {errors.amount.message}
            </FieldDescription>
          ) : (
            <FieldDescription
              id="record-amount-hint"
              className={overpaying ? "text-warn" : undefined}
            >
              {overpaying
                ? "More than they owe — they will be in credit."
                : "No UPI limit applies here."}
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.method ? true : undefined}>
          <FieldLabel htmlFor="record-method" required>
            How it arrived
          </FieldLabel>
          <Select
            value={method}
            // Base UI can emit null when a select is cleared; there is no
            // "no method" here, so a clear keeps what was chosen.
            onValueChange={(v) =>
              v && setValue("method", v, { shouldValidate: true, shouldDirty: true })
            }
          >
            <SelectTrigger id="record-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VENDOR_PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.method ? (
            <FieldDescription role="alert" className="text-danger">
              {errors.method.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Field data-invalid={errors.receivedOn ? true : undefined}>
          <FieldLabel htmlFor="record-received" required>
            Day it arrived
          </FieldLabel>
          <Input
            id="record-received"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            aria-invalid={errors.receivedOn ? true : undefined}
            aria-describedby={
              errors.receivedOn ? "record-received-error" : "record-received-hint"
            }
            {...register("receivedOn")}
          />
          {errors.receivedOn ? (
            <FieldDescription
              id="record-received-error"
              role="alert"
              className="text-danger"
            >
              {errors.receivedOn.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="record-received-hint">
              Not today if it landed earlier.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.reference ? true : undefined}>
          <FieldLabel htmlFor="record-reference">Reference</FieldLabel>
          <Input
            id="record-reference"
            autoComplete="off"
            className="font-mono"
            placeholder={method === "Cash" ? "None" : "UTR or cheque number"}
            aria-invalid={errors.reference ? true : undefined}
            aria-describedby={
              errors.reference ? "record-reference-error" : "record-reference-hint"
            }
            {...register("reference")}
          />
          {errors.reference ? (
            <FieldDescription
              id="record-reference-error"
              role="alert"
              className="text-danger"
            >
              {errors.reference.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="record-reference-hint">
              Optional — cash has none. Stops the same money being recorded twice.
            </FieldDescription>
          )}
        </Field>
      </div>

      <Field data-invalid={errors.note ? true : undefined}>
        <FieldLabel htmlFor="record-note">Note</FieldLabel>
        <Textarea
          id="record-note"
          rows={2}
          placeholder="e.g. Against invoice 4412"
          aria-invalid={errors.note ? true : undefined}
          {...register("note")}
        />
        {errors.note ? (
          <FieldDescription role="alert" className="text-danger">
            {errors.note.message}
          </FieldDescription>
        ) : null}
      </Field>

      <Field>
        <FieldLabel htmlFor="record-file">Attachment</FieldLabel>
        <input
          ref={fileRef}
          id="record-file"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="sr-only"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            if (picked && picked.size > MAX_UPLOAD_BYTES) {
              toast.add({ title: `${picked.name} is too large` });
              return;
            }
            setFile(picked);
          }}
        />
        {file ? (
          <div className="flex items-center gap-2 text-[13px]">
            <Paperclip className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              className="ml-auto rounded p-1 text-ink-3 hover:text-ink"
              aria-label={`Remove ${file.name}`}
              onClick={() => {
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
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
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip data-icon="inline-start" />
            Attach the statement line
          </Button>
        )}
        <FieldDescription>
          Optional — the bank line it was read off is not always yours to attach.
        </FieldDescription>
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
          Record payment
        </Button>
      </DialogFooter>
    </form>
  );
}
