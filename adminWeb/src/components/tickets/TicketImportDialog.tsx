import * as React from "react";
import { TicketImportPanel } from "@/components/tickets/TicketImportPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useVendorOptions } from "@/hooks/useVendors";

/**
 * Staff importing a vendor's spreadsheet for them.
 *
 * A dialog where the vendor's own importer is a page, and the difference is
 * which question is being answered. On the portal the vendor is already known
 * and importing IS the screen; here it is an action taken from the board, about
 * a vendor chosen first — so it belongs over the board, the way
 * `SerialImportDialog` belongs over the model it loads.
 *
 * **The vendor is picked here and sent as a form field**, never read from a
 * sheet. `POST /tickets` has no `vendorId` for the reason its schema states —
 * "a field that could name one would be the whole tenancy boundary sitting in a
 * request body" — and that reasoning is about a VENDOR naming a vendor. A staff
 * principal has no `vendor_id` at all, so it must name one; the server resolves
 * it through a company-scoped loader that 404s on anything outside the caller's
 * company, exactly as `_load_node` and `_load_model` do.
 *
 * Gated by `jobs.import` at the call site, which is its own key and not
 * `jobs.create` — see the server's note on why re-granting that to staff would
 * undo `d5f61c07ab29`.
 */
export function TicketImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [vendorId, setVendorId] = React.useState("");
  const vendors = useVendorOptions();
  const options = React.useMemo(
    () => (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
    [vendors.data]
  );

  // A company with one vendor should not be asked which (hard rule 10). The
  // hook takes the VALUES, not the option objects — it hands the single one
  // straight to the setter.
  const ids = React.useMemo(() => options.map((o) => o.value), [options]);
  useAutoSelectSingle(ids, vendorId, setVendorId);

  const chosen = options.find((o) => o.value === vendorId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import tickets</DialogTitle>
          <DialogDescription>
            Upload a vendor's spreadsheet on their behalf. The tickets are
            raised against that vendor; the trail records that you imported
            them.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <Field>
            <FieldLabel htmlFor="import-vendor">Vendor</FieldLabel>
            <Select
              value={vendorId}
              onValueChange={(next) => setVendorId(next ?? "")}
            >
              <SelectTrigger id="import-vendor">
                <SelectValue placeholder="Choose a vendor" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Mounted only once a vendor is chosen: every figure the panel shows
              — the products it would create, the credits, what is already
              imported — is that vendor's, so there is nothing true to draw
              before one is picked. */}
          {vendorId ? (
            <TicketImportPanel
              key={vendorId}
              vendorId={vendorId}
              vendorName={chosen?.label}
              onDone={() => onOpenChange(false)}
            />
          ) : (
            <p className="text-[13px] text-ink-3">
              Choose a vendor to upload their sheet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
