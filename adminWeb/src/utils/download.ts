/**
 * One blob download for every server-authored file in the console.
 *
 * The body is `downloadTicketTemplate`'s (services/tickets.ts), promoted on its
 * third consumer: the ticket import template, the serial import template and
 * now the employee statement CSV all ask the API for bytes and hand them to the
 * browser. `downloadCsv` stays for content the console BUILDS (the ledger
 * export) — this one is for content the server already shaped, which must be
 * saved byte-for-byte, UTF-8 BOM included (the ₹ survives Excel).
 *
 * A temporary anchor, a click, a revoke. The timeout is a grace, not a
 * guarantee: Firefox needs the revoke deferred, and ten seconds is what the
 * first copy shipped with.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}