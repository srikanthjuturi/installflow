import {
  useFieldArray,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { VendorBrand } from "@/types/vendor";
import { MAX_BRANDS, MAX_BRAND_NAME, type VendorFormValues } from "./vendorSchema";

/**
 * The brands a vendor sells, as editable rows — the vendor form's Brands section.
 *
 * A vendor is a COMPANY; a brand is what is printed on the unit, and one
 * company sells several (Crestline Distributors sells Meridian and Sunview).
 * Rows staff add here are approved as they are saved — the people setting up
 * the vendor are the people who would approve them.
 *
 * `ParameterFields`' row pattern: objects keyed by `field.id` (never the index,
 * or removing a row moves the cursor), and an Add button that stays mounted
 * and goes disabled at the cap rather than vanishing under the pointer.
 *
 * Two kinds of row are NOT editable here, and both say why rather than just
 * greying out:
 *   * a brand the VENDOR added that is still waiting, or was refused — it is
 *     decided on the Approvals screen, and shown so staff know it exists;
 *   * an approved brand that products carry cannot be REMOVED (renaming is
 *     fine) — the save would be refused, so the button is not offered.
 *
 * Net-new copy, NOT from the prototype, which has no brands. Needs sign-off.
 */
export function BrandRowsField({
  control,
  register,
  errors,
  saved,
}: {
  control: Control<VendorFormValues>;
  register: UseFormRegister<VendorFormValues>;
  errors: FieldErrors<VendorFormValues>;
  /** The vendor's brands as last saved, for product counts. Empty on add. */
  saved: VendorBrand[];
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "brands" });
  const counts = new Map(saved.map((b) => [b.id, b.productCount]));
  const rowErrors = errors.brands;
  const listError = rowErrors?.root?.message ?? rowErrors?.message;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2" aria-label="Brands">
        {fields.map((field, index) => {
          const waiting = field.waiting;
          // `brandId`, not `id`: `useFieldArray` owns `field.id` as its row key.
          const products = field.brandId ? (counts.get(field.brandId) ?? 0) : 0;
          const nameError = rowErrors?.[index]?.name?.message;
          return (
            <li key={field.id} className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Brand ${index + 1}`}
                    placeholder="e.g. Sunview"
                    maxLength={MAX_BRAND_NAME}
                    readOnly={waiting !== undefined}
                    disabled={waiting !== undefined}
                    aria-invalid={nameError ? true : undefined}
                    {...register(`brands.${index}.name`)}
                  />
                  {waiting ? (
                    <span
                      className={
                        waiting === "rejected"
                          ? "shrink-0 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger"
                          : "shrink-0 rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-semibold text-warn"
                      }
                    >
                      {waiting === "rejected" ? "Not approved" : "Pending approval"}
                    </span>
                  ) : products > 0 ? (
                    <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">
                      {products} product{products === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                {nameError ? (
                  <FieldDescription role="alert" className="text-danger">
                    {nameError}
                  </FieldDescription>
                ) : null}
              </div>
              {/* Not offered for a waiting brand (decided on Approvals) or an
                  approved one that products carry (the save would refuse it). */}
              {waiting === undefined && products === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove brand ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  <X aria-hidden />
                </Button>
              ) : (
                <span className="size-9 shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>

      {listError ? (
        <FieldDescription role="alert" className="text-danger">
          {listError}
        </FieldDescription>
      ) : null}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= MAX_BRANDS}
          onClick={() => append({ name: "" })}
        >
          <Plus data-icon="inline-start" aria-hidden />
          Add brand
        </Button>
      </div>
    </div>
  );
}
