import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  UserX,
} from "lucide-react";
import { NewCategoryTree } from "@/components/tickets/NewCategoryTree";
import { Notice } from "@/components/shared/Notice";
import { RejectsTable } from "@/components/shared/RejectsTable";
import { useFilePicker } from "@/components/shared/useFilePicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useImportTickets } from "@/hooks/useTickets";
import {
  MAX_TICKET_IMPORT_BYTES,
  MAX_TICKET_IMPORT_ROWS,
  TICKET_IMPORT_ACCEPT,
  downloadTicketTemplate,
} from "@/services/tickets";
import type { TicketImportReport } from "@/types/ticket";
import { moneyPaise } from "@/utils/money";

/**
 * Raise many tickets from one spreadsheet.
 *
 * The third member of a family: `superadmin/GeoImportDialog` and
 * `masters/SerialImportDialog` are the other two, and this keeps their shape
 * deliberately — two passes over one file, the first a dry run that writes
 * nothing and returns exactly what the second would do, so the numbers on
 * screen are the server's own count and not a guess made in the browser.
 * Nothing is parsed here; no spreadsheet library ships to the client.
 *
 * ## Where the confirmation lives
 *
 * The requirement asks for a popup listing the categories an import will
 * create. It is HERE — the preview and the footer — and not a second dialog,
 * for four reasons in descending weight:
 *
 *   * `shared/ConfirmDialog` hard-codes a red `variant="destructive"` button.
 *     Creating categories is additive, and a red button would tell somebody a
 *     safe act is dangerous.
 *   * The preview already IS the confirmation: it says what will happen, that
 *     nothing is saved yet, and the button names the count. A second modal
 *     asks the same question with strictly less on screen, or has to redraw
 *     the tree it just covered up.
 *   * A dialog over a dialog is a focus-trap problem `Dialog` does not solve.
 *   * Two shipped importers set the pattern, and a third that behaves
 *     differently is a third thing to learn.
 *
 * One deliberate divergence from those two, and it is the confirmation itself:
 * when a chain would be created, a CHECKBOX above the footer gates the commit.
 * It appears only when there is something to confirm, so the ordinary case is
 * the twins unchanged. The argument for it is that a vendor cannot undo a
 * category — there is no vendor DELETE for a node — so the one irreversible
 * thing on this screen gets one deliberate act.
 */
export function TicketImportPanel({
  vendorId,
  vendorName,
  onDone,
}: {
  /** Staff only: whose tickets these are. Omitted on the vendor's own screen. */
  vendorId?: string;
  vendorName?: string;
  onDone?: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<TicketImportReport | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const run = useImportTickets();

  const picker = useFilePicker({
    accept: TICKET_IMPORT_ACCEPT,
    maxBytes: MAX_TICKET_IMPORT_BYTES,
    label: "spreadsheet",
    onFile: (chosen) => {
      setFile(chosen);
      setPreview(null);
      setConfirmed(false);
      // Checking is the whole point of choosing, so it starts immediately —
      // there is no second button to press before anything happens.
      run.mutate(
        { file: chosen, dryRun: true, createCategories: true, submitProducts: true, vendorId },
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
        submitProducts: true,
        // The dry run's own digest: if this is not the file whose numbers were
        // just confirmed, the server refuses rather than importing something
        // nobody looked at.
        expectedDigest: preview.fileDigest,
        vendorId,
      },
      {
        onSuccess: (report) => {
          const extras: string[] = [];
          if (report.categoriesCreated) {
            extras.push(`${report.categoriesCreated} categories created`);
          }
          if (report.productsSubmitted) {
            extras.push(
              `${report.productsSubmitted} products sent for approval`
            );
          }
          toast.add({
            title: `${report.imported.toLocaleString()} ticket${
              report.imported === 1 ? "" : "s"
            } raised`,
            description:
              extras.length > 0
                ? `${extras.join(", ")}. Every customer will be asked to pick a time.`
                : "Every customer will be asked to pick a time.",
          });
          setFile(null);
          setPreview(null);
          setConfirmed(false);
          onDone?.();
        },
      }
    );
  }

  const checking = run.isPending && !preview;
  const committing = run.isPending && !!preview;
  const blocked =
    !preview ||
    run.isPending ||
    preview.willImport === 0 ||
    preview.intakePaused ||
    preview.creditsShort ||
    // The VENDOR's own line, the second gate. Without these two, a vendor whose
    // credit is used up would press Import straight into a 409 — exactly what
    // the two above exist to prevent, one party along.
    preview.vendorCreditPaused ||
    preview.vendorCreditShort ||
    (needsConfirmation && !confirmed);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-[13px] text-ink-2">
          One row is one ticket. The <span className="font-medium text-ink">Category</span>{" "}
          column names the whole chain — anything in it that does not exist yet
          is created, and you are shown exactly what before anything is saved.
          Rows that cannot be read are listed with a reason and do not stop the
          rest.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void downloadTicketTemplate()}
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
              .xlsx or .csv, up to {MAX_TICKET_IMPORT_BYTES / (1024 * 1024)} MB
              and {MAX_TICKET_IMPORT_ROWS} rows
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

      {preview ? <Preview report={preview} vendorName={vendorName} /> : null}

      {/* A failed request is reported by the toaster (App.tsx), not here. */}
      <div className="grid gap-3 border-t border-line pt-4">
        {preview && needsConfirmation ? (
          <label className="flex items-start gap-2.5 text-[13px]">
            <Checkbox
              id="confirm-categories"
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
              ? `Import ${preview.willImport.toLocaleString()} ticket${
                  preview.willImport === 1 ? "" : "s"
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
}: {
  report: TicketImportReport;
  vendorName?: string;
}) {
  // Reading order, so the numbers tell a story: "we read N rows → X become
  // tickets → Y categories and Z products have to be made first → W were
  // already imported". Each category is its own tile so nobody has to decode a
  // sub-note to understand why "Tickets to raise" is 0.
  //
  // There is deliberately NO "Rejected" tile: the rejects table's own header
  // already says "N rows rejected — the rest still import", and a tile would
  // double-count against "Tickets to raise". Both twins make the same choice.
  const tiles: {
    label: string;
    value: string;
    hint?: string;
    dim?: boolean;
  }[] = [
    { label: "Rows read", value: report.rowsRead.toLocaleString() },
    {
      label: "Tickets to raise",
      value: report.willImport.toLocaleString(),
      hint:
        report.willImport !== report.rowsRead
          ? `of ${report.rowsRead.toLocaleString()}`
          : undefined,
    },
    {
      label: "New categories",
      value: report.categoriesToCreate.length.toLocaleString(),
      dim: report.categoriesToCreate.length === 0,
    },
    {
      label: "New products",
      value: report.productsToSubmit.length.toLocaleString(),
      hint: report.productsToSubmit.length > 0 ? "pending until priced" : undefined,
      dim: report.productsToSubmit.length === 0,
    },
    ...(report.alreadyImported > 0
      ? [
          {
            label: "Already imported",
            value: report.alreadyImported.toLocaleString(),
            hint: "same reference — skipped",
          },
        ]
      : []),
    // Staff only. `creditsRequired` is null for a vendor by design — a
    // company's balance is not its vendor's business, the same line
    // `intake-status` draws.
    ...(report.creditsRequired !== null && report.creditsPerTicket > 0
      ? [
          {
            label: "Credits needed",
            value: report.creditsRequired.toLocaleString(),
            hint:
              report.creditsAvailable !== null
                ? `${report.creditsAvailable.toLocaleString()} available`
                : undefined,
          },
        ]
      : []),
    // The vendor's own line. Shown to staff and vendor alike — see the type.
    // Only when there is something to owe: a file of nothing to import has
    // nothing to say about it.
    ...(report.vendorCreditRequiredPaise > 0
      ? [
          {
            label: "Vendor credit needed",
            value: moneyPaise(report.vendorCreditRequiredPaise),
            hint: `${moneyPaise(report.vendorCreditAvailablePaise)} left`,
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

      {report.intakePaused ? (
        <Notice tone="warn" icon={AlertTriangle} title="New tickets are paused">
          {vendorName
            ? `${vendorName}'s company needs to recharge before new tickets can be raised.`
            : "Your company needs to recharge before new tickets can be raised."}
        </Notice>
      ) : report.creditsShort ? (
        <Notice
          tone="warn"
          icon={AlertTriangle}
          title="Not enough credits for the whole file"
        >
          {report.creditsRequired !== null && report.creditsAvailable !== null
            ? `This file needs ${report.creditsRequired.toLocaleString()} credits and ${report.creditsAvailable.toLocaleString()} are available. The import is all or nothing, so top up first and upload again.`
            : "The import is all or nothing, so this file cannot be imported until the company has recharged."}
        </Notice>
      ) : report.vendorCreditPaused ? (
        <Notice
          tone="warn"
          icon={AlertTriangle}
          title="This vendor's credit limit is used up"
        >
          {vendorName
            ? `${vendorName} cannot raise tickets until they settle what they owe or their limit is raised.`
            : "Settle what you owe, or ask for a higher limit, before importing."}
        </Notice>
      ) : report.vendorCreditShort ? (
        <Notice
          tone="warn"
          icon={AlertTriangle}
          title="Not enough vendor credit for the whole file"
        >
          {`This file needs ${moneyPaise(report.vendorCreditRequiredPaise)} of credit and ${moneyPaise(report.vendorCreditAvailablePaise)} is left. The import is all or nothing, so settle up or split the file and upload again.`}
        </Notice>
      ) : null}

      {report.categoriesToCreate.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <p className="text-[13px] font-medium text-ink">
            {report.categoriesToCreate.length.toLocaleString()} new categor
            {report.categoriesToCreate.length === 1 ? "y" : "ies"} will be
            created
          </p>
          <p className="mb-2 text-[12px] text-ink-2">
            These names are not in the catalogue yet. A category belongs to the
            whole company, so it stays after this import.
          </p>
          <NewCategoryTree categories={report.categoriesToCreate} />
        </div>
      ) : null}

      {newMain.length > 0 ? (
        <Notice
          tone="warn"
          icon={UserX}
          title={`Nobody is certified for ${newMain.length} of these`}
        >
          No technicians are certified for{" "}
          {newMain
            .slice(0, 2)
            .map((c) => c.path)
            .join(", ")}
          {newMain.length > 2 ? ` and ${newMain.length - 2} more` : ""}. Jobs
          raised against them would escalate the moment they are raised, with
          nobody to offer them to.
        </Notice>
      ) : null}

      {report.productsToSubmit.length > 0 ? (
        <Notice
          tone="warn"
          icon={AlertTriangle}
          title={`${report.productsToSubmit.length} new products will be added, unpriced`}
        >
          A product has to be priced before it can be ticketed, so these are
          added and sent for approval. The{" "}
          {report.productsToSubmit.reduce((n, p) => n + p.rowCount, 0)} rows
          naming them do not import today — upload the file again once they are
          approved.
        </Notice>
      ) : null}

      {report.duplicateRowsInFile > 0 ? (
        <Notice tone="warn" icon={AlertTriangle} title="Some rows repeat">
          {report.duplicateRowsInFile} row
          {report.duplicateRowsInFile === 1 ? "" : "s"} repeat the same serial
          number, product and customer. They are all raised — a repeat visit to
          one unit is a real thing — so check them if they were not meant to be
          there.
        </Notice>
      ) : null}

      {report.rejected ? (
        <RejectsTable
          total={report.rejected}
          rows={report.rejects}
          filename="ticket-import-rejects.csv"
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
        Nothing has been saved yet. Importing raises the tickets it can, creates
        the categories and products it names, and leaves everything else alone.
        Every ticket is raised without a time, and the customer is sent a link to
        pick one.
      </p>
    </div>
  );
}
