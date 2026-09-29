import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UpiQrUpload } from "@/components/shared/UpiQrUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { ErrorState } from "@/components/shared/states";
import { usePaymentAccount, useSavePaymentAccount } from "@/hooks/useSettings";
import type { PaymentAccount } from "@/services/settings";

/** The server's own VPA shape (`core/upi.py`), for a faster message only. */
const VPA = /^[a-z0-9][a-z0-9._-]{1,48}@[a-z][a-z0-9]{1,29}$/;

const schema = z
  .object({
    upiId: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || VPA.test(v), "Enter a UPI ID like name@bank"),
    upiName: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || (v.length >= 2 && v.length <= 80),
        "Enter the name on the UPI account"
      ),
  })
  .superRefine((v, ctx) => {
    // Both or neither — an address with no name to check it against is half a
    // payee, and the API refuses it too.
    if (v.upiId && !v.upiName) {
      ctx.addIssue({
        code: "custom",
        path: ["upiName"],
        message: "Enter the name on the UPI account",
      });
    }
    if (v.upiName && !v.upiId) {
      ctx.addIssue({
        code: "custom",
        path: ["upiId"],
        message: "Enter the UPI ID",
      });
    }
  });

type Values = z.infer<typeof schema>;

/**
 * Where this company's VENDORS send what they owe it.
 *
 * ## Its own card, its own Save
 *
 * Not a field inside `RulesForm`, because it is not in `company_rules` and does
 * not go through `PUT /settings/rules`. It is stored on `companies`, for a
 * reason worth keeping straight: `company_rules` is stamped onto every ticket's
 * `rules_snapshot`, and a UPI address is not a term of a job. A separate
 * endpoint also means a separate guard — this one is `vendors.credit` plus a
 * National-Head floor, because it redirects money, where the rest of that form
 * is `settings.edit`.
 *
 * Empty means vendors cannot start a payment at all, and their Credit page says
 * so rather than offering a QR nobody could honour. Clearing it leaves any
 * payment already open payable: `vendor_payments` froze the pair when the
 * request was made, which is also why changing it never moves a QR a vendor is
 * already looking at.
 */
export function VendorPaymentAccountCard() {
  const { data, isLoading, isError, error, refetch } = usePaymentAccount();

  return (
    <Card className="mt-3.5">
      <CardHeader className="border-b">
        <CardTitle className="text-[15px] font-semibold">
          Where vendors pay you
        </CardTitle>
      </CardHeader>
      <CardContent className="py-1">
        {isError ? (
          <ErrorState
            title="Couldn't load your payment account"
            error={error}
            onRetry={() => refetch()}
          />
        ) : isLoading || !data ? (
          <div className="grid gap-3">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
        ) : (
          // Keyed on what was served so a successful save re-seeds the form's
          // defaults — the reason `RulesForm` is keyed the same way.
          <AccountForm key={data.updatedAt ?? "unset"} account={data} />
        )}
      </CardContent>
    </Card>
  );
}

function AccountForm({ account }: { account: PaymentAccount }) {
  const save = useSavePaymentAccount();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      upiId: account.upiId ?? "",
      upiName: account.upiName ?? "",
    },
  });

  function submit(values: Values) {
    save.mutate(
      { upiId: values.upiId || null, upiName: values.upiName || null },
      {
        onSuccess: () =>
          toast.add({
            title: values.upiId
              ? "Payment account saved"
              : "Payment account cleared",
            description: values.upiId
              ? "Vendors can pay what they owe by UPI from their Credit page."
              : "Vendors can't start a new payment until you add one. Payments already open can still be paid.",
          }),
      }
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <FieldGroup className="gap-3">
        <Field data-invalid={errors.upiId ? true : undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="company-upi-id">UPI ID</FieldLabel>
            <UpiQrUpload
              onScanned={({ vpa, name }) => {
                // Both fields from the QR — the name only when it carried one,
                // so a bare-address code does not wipe what was typed.
                setValue("upiId", vpa, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                if (name) {
                  setValue("upiName", name, {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                }
              }}
            />
          </div>
          <Input
            id="company-upi-id"
            autoComplete="off"
            placeholder="e.g. accounts@okicici"
            className="font-mono"
            aria-invalid={errors.upiId ? true : undefined}
            aria-describedby={
              errors.upiId ? "company-upi-id-error" : "company-upi-id-hint"
            }
            {...register("upiId")}
          />
          {errors.upiId ? (
            <FieldDescription
              id="company-upi-id-error"
              role="alert"
              className="text-danger"
            >
              {errors.upiId.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="company-upi-id-hint">
              Every vendor&apos;s payment QR pays this UPI ID. Leave it empty and
              no vendor can start a payment.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.upiName ? true : undefined}>
          <FieldLabel htmlFor="company-upi-name">
            Name on the UPI account
          </FieldLabel>
          <Input
            id="company-upi-name"
            autoComplete="off"
            aria-invalid={errors.upiName ? true : undefined}
            aria-describedby={
              errors.upiName ? "company-upi-name-error" : "company-upi-name-hint"
            }
            {...register("upiName")}
          />
          {errors.upiName ? (
            <FieldDescription
              id="company-upi-name-error"
              role="alert"
              className="text-danger"
            >
              {errors.upiName.message}
            </FieldDescription>
          ) : (
            <FieldDescription id="company-upi-name-hint">
              What a vendor&apos;s UPI app shows when they scan — they are told
              to check it before paying.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2.5">
        {isDirty ? (
          <span className="mr-auto text-xs text-ink-3">Unsaved changes</span>
        ) : null}
        <Button type="submit" disabled={save.isPending || !isDirty}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save payment account
        </Button>
      </div>
    </form>
  );
}
