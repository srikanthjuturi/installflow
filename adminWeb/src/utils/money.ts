/**
 * Indian-format currency. Every rupee figure in the app goes through here —
 * the ledger, penalty bands and bonus pool must never disagree on format.
 *
 * Debits use a real minus sign (U+2212), not a hyphen, matching the prototype.
 */
export function money(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-IN");
  return `${n < 0 ? "−₹" : "₹"}${abs}`;
}
