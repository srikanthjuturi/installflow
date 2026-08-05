/**
 * Client-side CSV export.
 *
 * These downloads do not need the backend — the rows are already in the
 * browser. When a server-side export arrives (for datasets larger than the
 * page holds), swap the call site for a URL; the escaping rules below still
 * describe what the file must look like.
 */

/** Byte-order mark. Without it Excel reads the file as ANSI and ₹ mojibakes. */
const BOM = "\ufeff";

/**
 * RFC 4180 quoting: wrap in quotes when the value contains a comma, quote or
 * newline, and double any embedded quote.
 *
 * The leading-character guard is a spreadsheet-injection defence — a cell
 * beginning =, +, - or @ is executed as a formula by Excel and Sheets, so a
 * value like `=HYPERLINK(...)` arriving from vendor-supplied ticket data would
 * run on open. Prefixing a tab neutralises it without changing what is read.
 */
function escapeCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  // A well-formed number is exempt: -800 is a debit, not a formula, and
  // guarding it would make Excel read the column as text and refuse to sum it.
  const isNumeric = raw !== "" && Number.isFinite(Number(raw));
  const guarded = !isNumeric && /^[=+\-@]/.test(raw) ? `\t${raw}` : raw;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

/** Triggers a download of `content` as `filename`. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([BOM, content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
