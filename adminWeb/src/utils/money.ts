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

/**
 * The same, for a figure the API sent in PAISE — which is every money value it
 * stores (its hard rule 9: never a float, never a formatted string).
 *
 * Null renders as an em-dash, deliberately and not as ₹0. A ticket with no
 * bonus has had no amount decided for it; ₹0 would assert somebody priced it
 * at nothing. Same reading as a null rating or a null daily cap.
 *
 * It exists so `/ 100` never appears at a call site. Rounding is the caller's
 * problem nowhere: paise divide into rupees exactly, and a fractional rupee is
 * a bug upstream rather than something to hide here.
 */
export function moneyPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return money(paise / 100);
}

/**
 * A paise figure as the bare rupee digits a form field holds — `45000` → `"450"`.
 *
 * Unformatted on purpose: this is the inverse of the `Number(value) * 100` a
 * form does on submit, so it must round-trip. `moneyPaise` would put a ₹ and a
 * thousands separator into an `<input>` that then fails its own numeric
 * validation on the next save.
 *
 * Empty string for null, because that is what an untouched required field
 * holds and what its "is required" message is keyed on.
 */
export function paiseToRupeeInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  return String(paise / 100);
}
