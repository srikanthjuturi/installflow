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
import { useImportGeography } from "@/hooks/useGeo";
import { IMPORT_ACCEPT, MAX_IMPORT_BYTES } from "@/services/geo";
import { downloadCsv, toCsv } from "@/utils/csv";
import type { ImportReport } from "@/types/geo";

/**
 * Load Region / State / District / Pin Code from a spreadsheet.
 *
 * Two passes over the same file, deliberately: the first is a dry run that
 * writes nothing and returns exactly what the second would do, so the numbers
 * on screen are the server's own count and not a guess made in the browser.
 * Nothing is parsed here — no spreadsheet library ships to the client.
 *
 * Rejected rows never block the file. They are counted, listed and downloadable,
 * and the good rows import regardless.
 */
export function GeoImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-slim max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <ImportForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ImportReport | null>(null);
  const runImport = useImportGeography();

  const picker = useFilePicker({
    accept: IMPORT_ACCEPT,
    maxBytes: MAX_IMPORT_BYTES,
    label: "spreadsheet",
    onFile: (chosen) => {
      setFile(chosen);
      setPreview(null);
      // Checking is the whole point of choosing, so it starts immediately —
      // there is no second button to press before anything happens.
      runImport.mutate(
        { file: chosen, dryRun: true },
        { onSuccess: setPreview }
      );
    },
  });

  function commit() {
    if (!file) return;
    runImport.mutate(
      { file, dryRun: false },
      {
        onSuccess: (report) => {
          toast.add({
            title: "Geography updated",
            description: describeOutcome(report),
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
        <DialogTitle>Import geography</DialogTitle>
        <DialogDescription>
          A sheet of Region, State, District and Pin Code — one row per pincode
          or per post office. Rows that cannot be read are listed with a reason
          and do not block the rest.
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
              .xlsx or .csv, up to {MAX_IMPORT_BYTES / (1024 * 1024)} MB
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
          disabled={!preview || runImport.isPending || importableCount(preview) === 0}
        >
          {committing ? <Spinner data-icon="inline-start" /> : null}
          {preview ? `Import ${importableCount(preview).toLocaleString()} pincodes` : "Import"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function importableCount(report: ImportReport | null): number {
  if (!report) return 0;
  const p = report.pincodes;
  return p.created + p.updated + p.moved;
}

function describeOutcome(report: ImportReport): string {
  const parts = [
    `${report.states.created + report.states.updated} states`,
    `${(
      report.pincodes.created + report.pincodes.updated
    ).toLocaleString()} pincodes`,
  ];
  if (report.pincodes.moved) parts.push(`${report.pincodes.moved} moved state`);
  return parts.join(" · ");
}

function Preview({ report }: { report: ImportReport }) {
  const tiles: { label: string; value: string; hint?: string }[] = [
    {
      label: "Rows read",
      value: report.rowsRead.toLocaleString(),
      hint: report.rowsSkipped
        ? `${report.rowsSkipped.toLocaleString()} unreadable in the source`
        : undefined,
    },
    {
      label: "States",
      value: (report.states.created + report.states.updated).toLocaleString(),
      hint: report.states.created ? `${report.states.created} new` : undefined,
    },
    {
      label: "Districts",
      value: (
        report.districts.created + report.districts.updated
      ).toLocaleString(),
      hint: report.districts.created
        ? `${report.districts.created} new`
        : undefined,
    },
    {
      label: "Pincodes",
      value: (
        report.pincodes.created + report.pincodes.updated
      ).toLocaleString(),
      hint: report.pincodes.created
        ? `${report.pincodes.created.toLocaleString()} new`
        : undefined,
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-line bg-surface-2 px-3 py-2.5"
          >
            <p className="text-[11px] font-medium text-ink-3">{t.label}</p>
            <p className="text-lg font-semibold text-ink">{t.value}</p>
            {t.hint ? (
              <p className="text-[11px] text-ink-3">{t.hint}</p>
            ) : null}
          </div>
        ))}
      </div>

      {/* A pincode or state changing parent moves somebody's territory with it,
          so it gets its own line rather than being folded into "updated". */}
      {report.pincodes.moved || report.states.moved ? (
        <Notice tone="warn" icon={AlertTriangle} title="Some rows change hands">
          {report.states.moved
            ? `${report.states.moved} state(s) move to a different region. `
            : ""}
          {report.pincodes.moved
            ? `${report.pincodes.moved.toLocaleString()} pincode(s) move to a different state. `
            : ""}
          Whoever covers them changes with them.
        </Notice>
      ) : null}

      {report.unusedRegions.length ? (
        <Notice tone="warn" icon={AlertTriangle} title="Regions with no states">
          {report.unusedRegions.join(", ")} — nothing in this file sits in{" "}
          {report.unusedRegions.length === 1 ? "it" : "them"}, so a regional head
          given {report.unusedRegions.length === 1 ? "it" : "them"} would cover
          nothing.
        </Notice>
      ) : null}

      {report.overrides.length ? (
        <details className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">
            {report.overrides.length} researched correction
            {report.overrides.length === 1 ? "" : "s"} applied
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {report.overrides.map((o) => (
              <li key={o.pincode} className="text-[12px] text-ink-2">
                <span className="font-mono text-ink">{o.pincode}</span> →{" "}
                <span className="font-medium text-ink">{o.state}</span>
                {o.outcome === "agreed" ? (
                  <span className="text-ink-3"> (file already agreed)</span>
                ) : null}
                <span className="block text-ink-3">{o.reason}</span>
              </li>
            ))}
          </ul>
        </details>
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
                  "geography-rejects.csv",
                  toCsv(
                    ["Row", "Pincode", "Reason"],
                    report.rejects.map((r) => [r.row ?? "", r.pincode ?? "", r.reason])
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
                    Pincode
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rejects.map((r, i) => (
                  <tr key={`${r.pincode ?? "row"}-${r.row ?? i}`} className="bg-danger-bg/40">
                    <td className="px-3 py-1.5 text-ink-3">{r.row ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-ink">
                      {r.pincode ?? "—"}
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
        Nothing has been saved yet. Importing adds and updates what the file
        names, and leaves anything it does not name alone.
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
