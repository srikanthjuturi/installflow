import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { Notice } from "@/components/shared/Notice";
import { RejectsTable } from "@/components/shared/RejectsTable";
import { useFilePicker } from "@/components/shared/useFilePicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useAutoSelectSingle } from "@/hooks/useAutoSelectSingle";
import { useImportProducts } from "@/hooks/useProductMaster";
import { useVendorOptions } from "@/hooks/useVendors";
import {
  MAX_PRODUCT_IMPORT_BYTES,
  PRODUCT_IMPORT_ACCEPT,
  downloadProductTemplate,
} from "@/services/productMaster";
import type { ProductImportReport } from "@/types/product";

/**
 * Bulk-add or bulk-update products from one spreadsheet.
 *
 * The fourth member of the import family — `superadmin/GeoImportDialog`,
 * `masters/SerialImportDialog` and `tickets/TicketImportPanel` are the other
 * three — and it keeps their shape: two passes over one file, the first a dry
 * run that writes nothing and returns exactly what the second would do, so
 * the numbers on screen are the server's own count. Nothing is parsed here;
 * no spreadsheet library ships to the client.
 *
 * **Re-uploading the same sheet UPDATES** the products it already wrote
 * (matched by category, brand and name) rather than refusing a duplicate —
 * unlike the ticket importer, there is no separate "Reference" column and no
 * "already imported" tile; the preview's "To update" count IS that story.
 *
 * `portal` picks the door, the same way `SerialImportDialog` does:
 *
 *   - **`portal`** — a vendor's own upload (`/masters/portal/products/import`).
 *     Unpriced and pending, same as a single submission. No vendor to choose.
 *   - **staff (default)** — a vendor is picked here and sent as a form field,
 *     the same reasoning `TicketImportDialog` gives for `POST
 *     /tickets/import/on-behalf`: there is no column for it in the sheet (the
 *     tenancy boundary would otherwise sit in a request body), so a staff
 *     caller must name one and the server resolves it through a
 *     company-scoped loader. Every figure the form shows — what would be
 *     created, what brand names resolve against — is that vendor's, so
 *     nothing is mounted before one is chosen.
 */
export function ProductImportDialog({
  open,
  onOpenChange,
  portal = false,
  vendorId: ownVendorId,
  vendorName: ownVendorName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Uploads through the vendor's own-product endpoint. */
  portal?: boolean;
  /** The portal caller's own vendor — required when `portal` is true. */
  vendorId?: string;
  vendorName?: string;
}) {
  const [pickedVendorId, setPickedVendorId] = React.useState("");
  const vendors = useVendorOptions();
  const vendorOptions = React.useMemo(
    () => (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
    [vendors.data]
  );
  // A company with one vendor should not be asked which (hard rule 10).
  const vendorIds = React.useMemo(
    () => vendorOptions.map((o) => o.value),
    [vendorOptions]
  );
  useAutoSelectSingle(vendorIds, pickedVendorId, setPickedVendorId);

  const vendorId = portal ? ownVendorId : pickedVendorId;
  const vendorName = portal
    ? ownVendorName
    : vendorOptions.find((o) => o.value === pickedVendorId)?.label;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import products</DialogTitle>
          <DialogDescription>
            {portal
              ? "Add or update several of your own products from one spreadsheet."
              : "Upload a vendor's product sheet on their behalf. Re-uploading it later updates what it already added."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {portal ? null : (
            <Field>
              <FieldLabel htmlFor="product-import-vendor">Vendor</FieldLabel>
              <Select
                value={pickedVendorId}
                onValueChange={(next) => setPickedVendorId(next ?? "")}
              >
                <SelectTrigger id="product-import-vendor">
                  <SelectValue placeholder="Choose a vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendorOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {/* Mounted only once a vendor is known: every figure the form shows
              — what would be created or updated, which brands resolve — is
              that vendor's, so there is nothing true to draw before one is
              set. */}
          {vendorId ? (
            <ImportForm
              key={vendorId}
              vendorId={vendorId}
              vendorName={vendorName}
              portal={portal}
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

function ImportForm({
  vendorId,
  vendorName,
  portal,
  onDone,
}: {
  vendorId: string;
  vendorName?: string;
  portal: boolean;
  onDone: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ProductImportReport | null>(
    null
  );
  const [confirmed, setConfirmed] = React.useState(false);
  const run = useImportProducts();

  const picker = useFilePicker({
    accept: PRODUCT_IMPORT_ACCEPT,
    maxBytes: MAX_PRODUCT_IMPORT_BYTES,
    label: "spreadsheet",
    onFile: (chosen) => {
      setFile(chosen);
      setPreview(null);
      setConfirmed(false);
      // Checking is the whole point of choosing, so it starts immediately —
      // there is no second button to press before anything happens.
      run.mutate(
        {
          file: chosen,
          dryRun: true,
          createCategories: true,
          vendorId: portal ? undefined : vendorId,
        },
        { onSuccess: setPreview }
      );
    },
  });

  const needsConfirmation = (preview?.categoriesToCreate.length ?? 0) > 0;

  function commit() {
    if (!file || !preview) return;
    run.mutate(
      {
        file,
        dryRun: false,
        createCategories: true,
        // The dry run's own digest: if this is not the file whose numbers
        // were just confirmed, the server refuses rather than importing
        // something nobody looked at.
        expectedDigest: preview.fileDigest,
        vendorId: portal ? undefined : vendorId,
      },
      {
        onSuccess: (report) => {
          const extras: string[] = [];
          if (report.created) {
            extras.push(
              `${report.created} added`
            );
          }
          if (report.updated) {
            extras.push(`${report.updated} updated`);
          }
          if (report.categoriesCreated) {
            extras.push(`${report.categoriesCreated} categories created`);
          }
          toast.add({
            title: "Products imported",
            description:
              extras.length > 0 ? extras.join(", ") : "Nothing changed.",
          });
          setFile(null);
          setPreview(null);
          setConfirmed(false);
          onDone();
        },
      }
    );
  }

  const checking = run.isPending && !preview;
  const committing = run.isPending && !!preview;
  const blocked =
    !preview ||
    run.isPending ||
    (preview.toCreate === 0 && preview.toUpdate === 0) ||
    (needsConfirmation && !confirmed);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-[13px] text-ink-2">
          One row is one product. The{" "}
          <span className="font-medium text-ink">Category</span> column names
          the whole chain — anything in it that does not exist yet is
          created, and you are shown exactly what before anything is saved.
          Rows that cannot be read are listed with a reason and do not stop
          the rest.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void downloadProductTemplate()}
        >
          <Download data-icon="inline-start" />
          Download template
        </Button>
      </div>

      <input {...picker.inputProps} />

      <button
        type="button"
        onClick={picker.open}
        {...picker.dropProps}
        className={`grid place-items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
          picker.dragging
            ? "border-brand-500 bg-surface-2 ring-2 ring-brand-500"
            : "border-line hover:border-brand-400 hover:bg-surface-2"
        }`}
      >
        <FileSpreadsheet className="size-7 text-ink-3" aria-hidden />
        {file ? (
          <>
            <span className="text-sm font-medium text-ink">{file.name}</span>
            <span className="text-[12px] text-ink-3">
              {(file.size / (1024 * 1024)).toFixed(1)} MB · click or drop to
              replace
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-ink">
              Choose a file, or drag it here
            </span>
            <span className="text-[12px] text-ink-3">
              .xlsx or .csv, up to {MAX_PRODUCT_IMPORT_BYTES / (1024 * 1024)} MB
            </span>
          </>
        )}
      </button>

      {picker.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {picker.error}
        </p>
      ) : null}

      {checking ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          <Spinner />
          Checking the file — nothing is saved yet.
        </p>
      ) : null}

      {preview ? (
        <Preview report={preview} vendorName={vendorName} portal={portal} />
      ) : null}

      {/* A failed request is reported by the toaster (App.tsx), not here. */}
      <div className="grid gap-3 border-t border-line pt-4">
        {preview && needsConfirmation ? (
          <label className="flex items-start gap-2.5 text-[13px]">
            <Checkbox
              id="product-import-confirm-categories"
              checked={confirmed}
              onCheckedChange={(next) => setConfirmed(next === true)}
              className="mt-0.5"
            />
            <span className="text-ink">
              Create these{" "}
              {preview.categoriesToCreate.length.toLocaleString()} categor
              {preview.categoriesToCreate.length === 1 ? "y" : "ies"} and
              sub-categories.
            </span>
          </label>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {file ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFile(null);
                setPreview(null);
                setConfirmed(false);
              }}
              disabled={run.isPending}
            >
              Clear
            </Button>
          ) : null}
          <Button type="button" onClick={commit} disabled={blocked}>
            {committing ? <Spinner data-icon="inline-start" /> : null}
            {preview
              ? `Import ${(preview.toCreate + preview.toUpdate).toLocaleString()} product${
                  preview.toCreate + preview.toUpdate === 1 ? "" : "s"
                }`
              : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Preview({
  report,
  vendorName,
  portal,
}: {
  report: ProductImportReport;
  vendorName?: string;
  portal: boolean;
}) {
  // Reading order, so the numbers tell a story: "we read N rows → X are new,
  // Y update what is already there → Z categories have to be made first".
  // There is deliberately NO "Rejected" tile — the rejects table's own header
  // already says "N rows rejected — the rest still import", the same choice
  // the ticket and serial importers make.
  const tiles: { label: string; value: string; hint?: string; dim?: boolean }[] =
    [
      { label: "Rows read", value: report.rowsRead.toLocaleString() },
      {
        label: "New products",
        value: report.toCreate.toLocaleString(),
        dim: report.toCreate === 0,
      },
      {
        label: "Products to update",
        value: report.toUpdate.toLocaleString(),
        hint:
          report.toUpdate > 0
            ? "already on file — matched by category, brand and name"
            : undefined,
        dim: report.toUpdate === 0,
      },
      {
        label: "New categories",
        value: report.categoriesToCreate.length.toLocaleString(),
        dim: report.categoriesToCreate.length === 0,
      },
      ...(report.duplicateRowsInFile > 0
        ? [
            {
              label: "Repeated in this file",
              value: report.duplicateRowsInFile.toLocaleString(),
              hint: "same product named twice — the second row is skipped",
            },
          ]
        : []),
    ];

  const newMain = report.categoriesToCreate.filter((c) => c.newMainSubcategory);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`rounded-lg border border-line px-3 py-2.5 ${
              t.dim ? "bg-surface-1 opacity-50" : "bg-surface-2"
            }`}
          >
            <p className="text-[11px] font-medium text-ink-3">{t.label}</p>
            <p className="text-lg font-semibold text-ink">{t.value}</p>
            {t.hint ? <p className="text-[11px] text-ink-3">{t.hint}</p> : null}
          </div>
        ))}
      </div>

      {report.categoriesToCreate.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <p className="text-[13px] font-medium text-ink">
            {report.categoriesToCreate.length.toLocaleString()} new categor
            {report.categoriesToCreate.length === 1 ? "y" : "ies"} will be
            created
          </p>
          <p className="mb-2 text-[12px] text-ink-2">
            These names are not in the catalogue yet. A category belongs to
            the whole company, so it stays after this import.
          </p>
          <ul className="grid gap-1.5 text-[12px] text-ink-2">
            {report.categoriesToCreate.map((c) => (
              <li key={c.path} className="flex flex-wrap items-baseline gap-1">
                <span className="font-medium text-ink">{c.path}</span>
                {c.newSegments.length > 0 ? (
                  <span className="text-ink-3">
                    — new: {c.newSegments.join(", ")}
                  </span>
                ) : c.markedLeaf ? (
                  <span className="text-ink-3">
                    — marked as the last sub-category
                  </span>
                ) : null}
                <span className="text-ink-3">
                  ({c.rowCount.toLocaleString()} row
                  {c.rowCount === 1 ? "" : "s"})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {newMain.length > 0 ? (
        <Notice
          tone="warn"
          icon={AlertTriangle}
          title={`Nobody is certified for ${newMain.length} of these`}
        >
          No technicians are certified for{" "}
          {newMain
            .slice(0, 2)
            .map((c) => c.path)
            .join(", ")}
          {newMain.length > 2 ? ` and ${newMain.length - 2} more` : ""}. A job
          raised against a product filed there would escalate the moment it
          is raised, with nobody to offer it to.
        </Notice>
      ) : null}

      {portal && report.toCreate > 0 ? (
        <Notice tone="ok" icon={Upload} title="New products wait for pricing">
          Every new product is added pending and unpriced, the same as
          submitting it by hand. A National Head sets both prices on
          Approvals before it can be ticketed.
        </Notice>
      ) : null}

      {!portal && report.toCreate > 0 ? (
        <Notice tone="ok" icon={Upload} title="New products are approved at once">
          {`Every new product is created approved and priced from the sheet's own figures — the same as adding it one at a time.${
            vendorName ? ` ${vendorName} can raise tickets against it immediately.` : ""
          }`}
        </Notice>
      ) : null}

      {report.rejected ? (
        <RejectsTable
          total={report.rejected}
          rows={report.rejects}
          filename="product-import-rejects.csv"
          keyOf={(r) => String(r.row)}
          columns={[
            { header: "Row", cell: (r) => r.row, tone: "muted" },
            { header: "Column", cell: (r) => r.field, tone: "muted" },
            { header: "Value", cell: (r) => r.value, tone: "mono" },
            { header: "Reason", cell: (r) => r.reason },
          ]}
        />
      ) : (
        <Notice tone="ok" icon={CheckCircle2} title="Every row can be read">
          Nothing was rejected.
        </Notice>
      )}

      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <Upload className="size-3.5" aria-hidden />
        Nothing has been saved yet. Importing writes the products it can, and
        leaves everything else alone.
      </p>
    </div>
  );
}
