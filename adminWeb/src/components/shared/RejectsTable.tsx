import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/utils/csv";

/**
 * The rows an importer could not read, with the reason for each.
 *
 * Promoted from `superadmin/GeoImportDialog` and `masters/SerialImportDialog`,
 * which held the same block twice and differed only in one column heading and
 * the download's filename. The ticket importer is the third caller.
 *
 * Two behaviours are load-bearing rather than stylistic, and both are the
 * reason this block exists at all:
 *
 *   * **Rejected rows never block the file.** The heading says so in those
 *     words, because the alternative — refusing the whole upload over one bad
 *     cell — is what makes people stop using an importer.
 *   * **The list is capped, the COUNT is not.** A file with 4,000 bad rows
 *     returns 200 of them and still reports 4,000, so the footer can say which
 *     is which. Never render `rows.length` as the total.
 */
export interface RejectColumn<T> {
  header: string;
  /** The cell's text. Null or undefined renders an em dash. */
  cell: (row: T) => string | number | null | undefined;
  /**
   * How it reads. `mono` is for a value somebody will compare character by
   * character — a serial, a pincode, a reference. `muted` is for the row
   * number. `body` (the default) is for prose.
   */
  tone?: "muted" | "mono" | "body";
}

export function RejectsTable<T>({
  total,
  rows,
  columns,
  filename,
  keyOf,
}: {
  /** Every rejected row, including the ones not in `rows`. */
  total: number;
  /** The ones actually returned — the server caps this. */
  rows: T[];
  columns: RejectColumn<T>[];
  /** e.g. `ticket-import-rejects.csv`. */
  filename: string;
  keyOf: (row: T, index: number) => string;
}) {
  // Static strings, one per tone — see hard rule 6.
  const toneClass = {
    muted: "px-3 py-1.5 text-ink-3",
    mono: "px-3 py-1.5 font-mono text-ink",
    body: "px-3 py-1.5 text-ink-2",
  } as const;

  return (
    <div className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-[13px] font-medium text-ink">
          {total.toLocaleString()} row{total === 1 ? "" : "s"} rejected
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
              filename,
              toCsv(
                columns.map((c) => c.header),
                rows.map((r) => columns.map((c) => c.cell(r) ?? ""))
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
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className="px-3 py-1.5 text-left font-medium"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={keyOf(r, i)} className="bg-danger-bg/40">
                {columns.map((c) => {
                  const value = c.cell(r);
                  return (
                    <td
                      key={c.header}
                      className={toneClass[c.tone ?? "body"]}
                    >
                      {value === null || value === undefined || value === ""
                        ? "—"
                        : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > rows.length ? (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
          Showing the first {rows.length} of {total.toLocaleString()}.
        </p>
      ) : null}
    </div>
  );
}
