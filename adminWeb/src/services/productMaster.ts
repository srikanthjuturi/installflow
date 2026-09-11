/**
 * Product master transport — live FastAPI, not the mock client.
 *
 * Every write returns the affected ROOT branch with its whole subtree, so the
 * console re-renders from one authoritative response instead of patching a
 * local tree and hoping it matches what the server did. That matters more now
 * that a change at any depth can move an inherited icon, an inherited parameter
 * or a technician count several levels below it.
 *
 * `/categories` and `/subcategories` were two halves of the same idea and are
 * now one `/nodes`. A node's level is its `depth`, not which URL created it.
 */

import type {
  CreateModelInput,
  CreateNodeInput,
  ProductModelSerial,
  ProductNode,
  ResubmitModelInput,
  SerialMatch,
  SerialAddResult,
  SerialImportReport,
  SubmitModelInput,
  UpdateModelInput,
  UpdateNodeInput,
} from "@/types/product";
import {
  apiDelete,
  apiGet,
  apiGetBlob,
  apiGetPage,
  apiPost,
  apiPut,
  apiUpload,
} from "./http";
import type { ListParams, Page } from "@/types/api";

/**
 * What the tree is being READ for.
 *
 *   catalogue  every approval state, and empty branches kept. Maintenance
 *              screens — the ops Categories page and a vendor's own products
 *              page, where a category with nothing in it yet is a real row
 *              somebody still has to fill.
 *   intake     approved products only, and the branches that leaves empty are
 *              pruned. The ticket form's pickers, which must never offer a path
 *              that dead-ends.
 *
 * One parameter rather than two flags, because the two settings are not
 * independent: approved-only while KEEPING empty branches is a picker full of
 * dead ends, which is the thing the pruning exists to prevent.
 */
export type TreePurpose = "catalogue" | "intake";

/**
 * The catalogue, whole or narrowed to one vendor. Roots, nested downward.
 *
 * `vendorId` returns only that vendor's models. For a VENDOR caller it is
 * ignored and their own id substituted server-side, so this cannot be widened
 * from the query string.
 */
export function listNodeTree(
  includeInactive = false,
  vendorId?: string,
  purpose: TreePurpose = "catalogue"
): Promise<ProductNode[]> {
  const query = new URLSearchParams();
  if (includeInactive) query.set("includeInactive", "true");
  if (vendorId) query.set("vendorId", vendorId);
  if (purpose !== "catalogue") query.set("purpose", purpose);
  const qs = query.toString();
  return apiGet<ProductNode[]>(`/masters/nodes${qs ? `?${qs}` : ""}`);
}

/* --------------------------------------------------------------- categories */

export function createNode(input: CreateNodeInput): Promise<ProductNode> {
  return apiPost<ProductNode>("/masters/nodes", input);
}

export function updateNode({
  id,
  ...body
}: UpdateNodeInput): Promise<ProductNode> {
  return apiPut<ProductNode>(`/masters/nodes/${id}`, body);
}

export function deleteNode(id: string): Promise<null> {
  return apiDelete<null>(`/masters/nodes/${id}`);
}

/* ------------------------------------------------------------------ models */

export function createModel({
  nodeId,
  ...body
}: CreateModelInput): Promise<ProductNode> {
  return apiPost<ProductNode>(`/masters/nodes/${nodeId}/models`, body);
}

export function updateModel({
  id,
  ...body
}: UpdateModelInput): Promise<ProductNode> {
  return apiPut<ProductNode>(`/masters/models/${id}`, body);
}

export function deleteModel(id: string): Promise<null> {
  return apiDelete<null>(`/masters/models/${id}`);
}

/* ------------------------------------------- a vendor's own submissions ---- */

/**
 * A vendor adds a category.
 *
 * Its own path only because of the guard on it: a category is company-wide and
 * carries no vendor, no price and no approval, so the server routes this
 * straight into the same writer staff use.
 */
export function submitNode(input: CreateNodeInput): Promise<ProductNode> {
  return apiPost<ProductNode>("/masters/portal/nodes", input);
}

/**
 * A vendor edits a category it CREATED (`ProductNode.isOwn`). Not reviewed,
 * same as the create.
 *
 * Any other category is a 404: a category is company-wide, so renaming one a
 * vendor did not add would change the catalogue for every vendor filing there.
 */
export function updateOwnNode({
  id,
  ...body
}: UpdateNodeInput): Promise<ProductNode> {
  return apiPut<ProductNode>(`/masters/portal/nodes/${id}`, body);
}

/**
 * A vendor submits a product. Unpriced, pending, and not yet ticketable.
 *
 * No `vendorId` and no prices in the body — there are no fields for them. The
 * server reads the vendor off the session, and a National Head types both
 * figures at approval.
 */
export function submitModel({
  nodeId,
  ...body
}: SubmitModelInput): Promise<ProductNode> {
  return apiPost<ProductNode>(`/masters/portal/nodes/${nodeId}/models`, body);
}

/**
 * A vendor edits their own product.
 *
 * An APPROVED product stays approved and keeps its prices — no review. A
 * REJECTED one that actually changes goes back to pending and re-notifies
 * staff, because saving it is the answer to the refusal. A pending one stays
 * pending.
 */
export function resubmitModel({
  id,
  ...body
}: ResubmitModelInput): Promise<ProductNode> {
  return apiPut<ProductNode>(`/masters/portal/models/${id}`, body);
}

export function deleteOwnModel(id: string): Promise<null> {
  return apiDelete<null>(`/masters/portal/models/${id}`);
}

/* ── model-wise serial numbers ─────────────────────────────────────────────── */
//
// The serials a model covers, checked at ticket intake. Staff manage any model
// in the company through these; a vendor manages its OWN through the `…Own…`
// twins below, which the server pins with `_load_own_model`.

/** Same ceiling and accepted kinds as the geography importer. */
export const MAX_SERIAL_IMPORT_BYTES = 16 * 1024 * 1024;
export const SERIAL_IMPORT_ACCEPT = ".xlsx,.csv";

export function listSerials(
  modelId: string,
  params: ListParams = {}
): Promise<Page<ProductModelSerial>> {
  return apiGetPage<ProductModelSerial>(
    `/masters/models/${modelId}/serials`,
    params
  );
}

/**
 * Add serials typed or pasted into the box.
 *
 * Takes a list because the box accepts a pasted block — the server trims, drops
 * blanks and de-duplicates case-insensitively, so the caller sends the split
 * lines as they are.
 */
export function addSerials(
  modelId: string,
  serials: string[]
): Promise<SerialAddResult> {
  return apiPost<SerialAddResult>(`/masters/models/${modelId}/serials`, {
    serials,
  });
}

/**
 * The same writes, for a VENDOR managing its own product's serials.
 *
 * Full control — add, import, correct, remove. It was add-only when it shipped,
 * because removing the last serial turns intake checking off for that model and
 * so lets a vendor lift its own gate. That was raised and the call was made to
 * hand it over: a vendor who cannot fix its own typo has to ring somebody to
 * correct a number only it can read. What remains is the WARNING before the
 * last one goes, not a refusal.
 */
export function addOwnSerials(
  modelId: string,
  serials: string[]
): Promise<SerialAddResult> {
  return apiPost<SerialAddResult>(`/masters/portal/models/${modelId}/serials`, {
    serials,
  });
}

export function importOwnSerials(
  modelId: string,
  file: File,
  { dryRun }: { dryRun: boolean }
): Promise<SerialImportReport> {
  const form = new FormData();
  form.append("file", file, file.name);
  return apiUpload<SerialImportReport>(
    `/masters/portal/models/${modelId}/serials/import?dryRun=${dryRun}`,
    form
  );
}

export function updateOwnSerial(
  modelId: string,
  serialId: string,
  serial: string
): Promise<ProductModelSerial> {
  return apiPut<ProductModelSerial>(
    `/masters/portal/models/${modelId}/serials/${serialId}`,
    { serial }
  );
}

export function deleteOwnSerial(
  modelId: string,
  serialId: string
): Promise<number> {
  return apiDelete<number>(
    `/masters/portal/models/${modelId}/serials/${serialId}`
  );
}

/**
 * Correct one serial IN PLACE, rather than removing it and adding the fix.
 *
 * The row keeps its `createdAt`, so a corrected typo still records when that
 * unit was loaded. A delete-and-re-add would restamp it to whoever fixed the
 * spelling.
 */
export function updateSerial(
  modelId: string,
  serialId: string,
  serial: string
): Promise<ProductModelSerial> {
  return apiPut<ProductModelSerial>(
    `/masters/models/${modelId}/serials/${serialId}`,
    { serial }
  );
}

/** Removes one, and answers with what the model holds afterwards. */
export function deleteSerial(
  modelId: string,
  serialId: string
): Promise<number> {
  return apiDelete<number>(`/masters/models/${modelId}/serials/${serialId}`);
}

/**
 * Upload the spreadsheet. `dryRun` validates and writes nothing, which is what
 * the preview step sends; the same file is sent again to commit.
 *
 * Two uploads rather than a server-side batch, exactly as `importGeography`
 * does: the file is a few MB, and a batch table would exist only to carry state
 * between two clicks.
 */
export function importSerials(
  modelId: string,
  file: File,
  { dryRun }: { dryRun: boolean }
): Promise<SerialImportReport> {
  const form = new FormData();
  // A part with no filename is not treated as a file upload at all, and the
  // server reads the extension off it to choose the parser.
  form.append("file", file, file.name);
  return apiUpload<SerialImportReport>(
    `/masters/models/${modelId}/serials/import?dryRun=${dryRun}`,
    form
  );
}

/**
 * Download the starter .xlsx.
 *
 * Fetched and turned into a blob rather than linked with a plain `<a href>`:
 * the endpoint is guarded like every other, and a bare link carries no
 * `Authorization` header, so it would download a 401 page named
 * `serial-numbers.xlsx`.
 */
export async function downloadSerialTemplate(): Promise<void> {
  const blob = await apiGetBlob("/masters/serials/template");
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "serial-numbers.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoked on the next tick, not immediately: Safari has not started the
    // download by the time click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * Which product a serial number belongs to — the intake form's autofill.
 *
 * A LIST, because the unique index is per (company, model): two products
 * sharing a numbering scheme is legal, if rare. An empty array is the ordinary
 * answer, not a failure — most serials are simply not loaded.
 *
 * The server pins a vendor to its OWN models, so this can never be used to read
 * back a competitor's catalogue.
 */
export function lookupSerial(
  serial: string,
  { offset = 0 }: { offset?: number } = {}
): Promise<SerialMatch[]> {
  const query = new URLSearchParams({ serial });
  if (offset) query.set("offset", String(offset));
  return apiGet<SerialMatch[]>(`/masters/serials/lookup?${query}`);
}

/**
 * One page of suggestions. The dropdown pages on scroll rather than stopping
 * here, and a SHORT page is how it knows it has reached the end — so this has
 * to match `MAX_SERIAL_MATCHES` in `api/app/features/masters/service.py`. Set
 * it lower here and the list would stop early believing it was done.
 */
export const SERIAL_PAGE_SIZE = 25;
