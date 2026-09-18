import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { useFilePicker } from "@/components/shared/useFilePicker";
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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useImportSerials } from "@/hooks/useProductMaster";
import {
  MAX_SERIAL_IMPORT_BYTES,
  SERIAL_IMPORT_ACCEPT,
} from "@/services/productMaster";
import { downloadCsv, toCsv } from "@/utils/csv";
import type { SerialImportReport } from "@/types/product";

/**
 * Load a model's serial numbers from a spreadsheet.
 *
 * A deliberate twin of `superadmin/GeoImportDialog` — two passes over the same
 * file, the first a dry run that writes nothing and returns exactly what the
 * second would do, so the numbers on screen are the server's own count and not
 * a guess made in the browser. Nothing is parsed here; no spreadsheet library
 * ships to the client.
 *
 * Rejected rows never block the file. They are counted, listed and
 * downloadable, and the good rows import regardless.
 */
export function SerialImportDialog({
  open,
  onOpenChange,
  modelId,
  modelName,
  portal = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  modelName: string;
  /** Uploads through the vendor's own-product endpoint. See `ModelSerialsPanel`. */
  portal?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <ImportForm
          modelId={modelId}
          modelName={modelName}
          portal={portal}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ImportForm({
  modelId,
  modelName,
  portal,
  onDone,
}: {
  modelId: string;
  modelName: string;
  portal: boolean;
  onDone: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<SerialImportReport | null>(null);
  const runImport = useImportSerials(modelId, portal);

  const picker = useFilePicker({
    accept: SERIAL_IMPORT_ACCEPT,
    maxBytes: MAX_SERIAL_IMPORT_BYTES,
    label: "spreadsheet",
    onFile: (chosen) => {
      setFile(chosen);
      setPreview(null);
      // Checking is the whole point of choosing, so it starts immediately —
      // there is no second button to press before anything happens.
      runImport.mutate({ file: chosen, dryRun: true }, { onSuccess: setPreview });
    },
  });

  function commit() {
    if (!file) return;
    runImport.mutate(
      { file, dryRun: false },
      {
        onSuccess: (report) => {
          toast.add({
            title: "Serial numbers added",
            description: `${modelName} now covers ${report.total.toLocaleString()}.`,
          });
          onDone();
        },
      }
    );
  }

  const checking = runImport.isPending && !preview;
  const committing = runImport.isPending && !!preview;

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Import serial numbers</DialogTitle>
        <DialogDescription>
          A sheet with one serial number per row, for {modelName}. A{" "}
          <span className="font-medium text-ink">Serial Number</span> heading is
          optional — a plain column works. Rows that cannot be read are listed
          with a reason and do not block the rest.
        </DialogDescription>
      </DialogHeader>

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
              .xlsx or .csv, up to {MAX_SERIAL_IMPORT_BYTES / (1024 * 1024)} MB
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

      {preview ? <Preview report={preview} /> : null}

      {/* A failed request is reported by the toaster (App.tsx), not here. */}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button
          type="button"
          onClick={commit}
          disabled={!preview || runImport.isPending || preview.added === 0}
        >
          {committing ? <Spinner data-icon="inline-start" /> : null}
          {preview
            ? `Import ${preview.added.toLocaleString()} serial${
                preview.added === 1 ? "" : "s"
              }`
            : "Import"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function Preview({ report }: { report: SerialImportReport }) {
  // Tiles are shown in reading order so the numbers tell a story:
  // "We read N rows → X are new → Y already on the model → Z duplicated in
  // the file → model ends up with T". Each category is its own tile so
  // a reader never has to decode a sub-note to understand why To add = 0.
  const tiles: {
    label: string;
    value: string;
    hint?: string;
    dim?: boolean;
  }[] = [
    { label: "Rows read", value: report.rowsRead.toLocaleString() },
    {
      label: "New — to add",
      value: report.added.toLocaleString(),
      hint: report.added === 0 ? "nothing new in this file" : undefined,
    },
    {
      label: "Already on this model",
      value: report.alreadyPresent.toLocaleString(),
      hint:
        report.alreadyPresent > 0
          ? "already loaded — will be skipped"
          : undefined,
      dim: report.alreadyPresent === 0,
    },
    ...(report.duplicatesInFile > 0
      ? [
          {
            label: "Repeated in this file",
            value: report.duplicatesInFile.toLocaleString(),
            hint: "same serial listed more than once — counted once",
          },
        ]
      : []),
    {
      label: "Model will hold",
      value: report.total.toLocaleString(),
    },
  ];

  // Build a plain-English summary of why nothing will be added, so the user
  // doesn't have to read four tiles and work it out themselves.
  function zeroAddReason(): string {
    const parts: string[] = [];
    if (report.alreadyPresent > 0) {
      parts.push(
        `${report.alreadyPresent} ${report.alreadyPresent === 1 ? "serial is" : "serials are"} already on this model`
      );
    }
    if (report.duplicatesInFile > 0) {
      parts.push(
        `${report.duplicatesInFile} ${report.duplicatesInFile === 1 ? "is" : "are"} repeated within the file and counted once`
      );
    }
    if (report.rejected > 0) {
      parts.push(
        `${report.rejected} ${report.rejected === 1 ? "row was" : "rows were"} rejected`
      );
    }
    return parts.length > 0
      ? parts.join(", ") + "."
      : "Nothing would change.";
  }

  return (
    <div className="grid gap-4">
      <div
        className={`grid gap-3 ${
          report.duplicatesInFile > 0
            ? "grid-cols-2 sm:grid-cols-5"
            : "grid-cols-2 sm:grid-cols-4"
        }`}
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`rounded-lg border border-line px-3 py-2.5 ${
              t.dim ? "bg-surface-1 opacity-50" : "bg-surface-2"
            }`}
          >
            <p className="text-[11px] font-medium text-ink-3">{t.label}</p>
            <p className="text-lg font-semibold text-ink">{t.value}</p>
            {t.hint ? (
              <p className="text-[11px] text-ink-3">{t.hint}</p>
            ) : null}
          </div>
        ))}
      </div>

      {report.added === 0 && report.rejected === 0 ? (
        <Notice
          tone="warn"
          icon={AlertTriangle}
          title="Nothing will be added"
        >
          {zeroAddReason()} That is the expected result of re-uploading a
          sheet that has already been imported.
        </Notice>
      ) : report.added === 0 && report.rejected > 0 ? (
        <Notice tone="warn" icon={AlertTriangle} title="Nothing will be added">
          {zeroAddReason()} Fix the rejected rows and re-upload to import them.
        </Notice>
      ) : null}

      {report.rejected ? (
        <div className="rounded-lg border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <p className="text-[13px] font-medium text-ink">
              {report.rejected.toLocaleString()} row
              {report.rejected === 1 ? "" : "s"} rejected
              <span className="ml-1 font-normal text-ink-3">
                — the rest still import
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "serial-rejects.csv",
                  toCsv(
                    ["Row", "Serial", "Reason"],
                    report.rejects.map((r) => [
                      r.row ?? "",
                      r.serial ?? "",
                      r.reason,
                    ])
                  )
                )
              }
            >
              <Download data-icon="inline-start" />
              Download
            </Button>
          </div>
          <div className="scroll-slim max-h-44 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-surface-2 text-ink-3">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    Row
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    Serial
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rejects.map((r, i) => (
                  <tr
                    key={`${r.serial ?? "row"}-${r.row ?? i}`}
                    className="bg-danger-bg/40"
                  >
                    <td className="px-3 py-1.5 text-ink-3">{r.row ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-ink">
                      {r.serial ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.rejected > report.rejects.length ? (
            <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
              Showing the first {report.rejects.length} of{" "}
              {report.rejected.toLocaleString()}.
            </p>
          ) : null}
        </div>
      ) : (
        <Notice tone="ok" icon={CheckCircle2} title="Every row can be read">
          Nothing was rejected.
        </Notice>
      )}

      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <Upload className="size-3.5" aria-hidden />
        Nothing has been saved yet. Importing adds what the file names and
        leaves anything it does not name alone.
      </p>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "ok" | "warn";
  icon: typeof AlertTriangle;
  title: string;
  children: React.ReactNode;
}) {
  // Static class strings — an interpolated `bg-${tone}-bg` is never generated.
  const skin =
    tone === "ok"
      ? "border-ok/30 bg-ok-bg text-ok"
      : "border-warn/30 bg-warn-bg text-warn";
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${skin}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-0.5">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-[12px] text-ink-2">{children}</p>
      </div>
    </div>
  );
}
