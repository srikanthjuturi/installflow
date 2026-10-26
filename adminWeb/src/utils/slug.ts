/**
 * A filename slug from free text — the regex `LedgerTable` inlined for its CSV
 * name, promoted when the statements page needed the same rule twice (the LEDGER
 * file names the company, the statement file names company AND franchisee).
 *
 * Lower-cases, folds every non-alphanumeric run into one `-`, and trims the
 * edge dashes so neither end of the name starts with junk. `"Acme & Co."` →
 * `acme-co`. An empty string stays empty; callers prefix it with something
 * known (`-ledger.csv`) so a file never gets a bare extension.
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}