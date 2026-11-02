/**
 * Numbered transaction documents - live FastAPI, one router for four readers.
 *
 * The server decides the scope from the caller alone (superadmin: every
 * company; Admin / National Head: their own; vendor: itself; franchisee admin:
 * theirs), so this file never sends a company id the caller was not given:
 * `companyId` is only ever set by the superadmin console (hard rule 0).
 */

import type { ListParams, Page } from "@/types/api";
import type {
  CompanyRollup,
  PartyKind,
  PartyOption,
  Requeued,
  Statement,
  TransactionDocument,
  TransactionQuery,
  TransactionSummary,
} from "@/types/transaction";
import { apiGet, apiGetBlob, apiGetPage, apiPost } from "./http";

const BASE = "/transactions";

/** Query-string for the filters the list and the summary share. Empty values are dropped. */
export function transactionQuery(q: TransactionQuery = {}): string {
  const sp = new URLSearchParams();
  if (q.from) sp.set("from", q.from);
  if (q.to) sp.set("to", q.to);
  if (q.docType) sp.set("docType", q.docType);
  if (q.partyKind) sp.set("partyKind", q.partyKind);
  if (q.partyId) sp.set("partyId", q.partyId);
  if (q.companyId) sp.set("companyId", q.companyId);
  if (q.search?.trim()) sp.set("search", q.search.trim());
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** The same filters as `ListParams.filters`, which `apiGetPage` flattens. */
function asFilters(q: TransactionQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.from) out.from = q.from;
  if (q.to) out.to = q.to;
  if (q.docType) out.docType = q.docType;
  if (q.partyKind) out.partyKind = q.partyKind;
  if (q.partyId) out.partyId = q.partyId;
  if (q.companyId) out.companyId = q.companyId;
  return out;
}

export function listTransactions(
  q: TransactionQuery,
  paging: Pick<ListParams, "page" | "limit"> = {}
): Promise<Page<TransactionDocument>> {
  return apiGetPage<TransactionDocument>(BASE, {
    ...paging,
    ...(q.search?.trim() ? { search: q.search.trim() } : {}),
    filters: asFilters(q),
  });
}

export function getTransactionSummary(
  q: TransactionQuery
): Promise<TransactionSummary> {
  return apiGet<TransactionSummary>(`${BASE}/summary${transactionQuery(q)}`);
}

export function getTransaction(id: string): Promise<TransactionDocument> {
  return apiGet<TransactionDocument>(`${BASE}/${id}`);
}

/** Who has documents - the party filter's options. A platform party has a null id. */
export function listTransactionParties(q: {
  partyKind?: PartyKind;
  search?: string;
  companyId?: string;
}): Promise<PartyOption[]> {
  return apiGet<PartyOption[]>(
    `${BASE}/parties${transactionQuery({
      partyKind: q.partyKind,
      search: q.search,
      companyId: q.companyId,
    })}`
  );
}

export interface StatementQuery {
  partyKind: PartyKind;
  /** Null for the platform. */
  partyId?: string | null;
  from: string;
  to: string;
  /** Superadmin only; the server answers 422 COMPANY_REQUIRED without it. */
  companyId?: string;
}

function statementQuery(q: StatementQuery): string {
  return transactionQuery({
    partyKind: q.partyKind,
    partyId: q.partyId ?? undefined,
    from: q.from,
    to: q.to,
    companyId: q.companyId,
  });
}

export function getStatement(q: StatementQuery): Promise<Statement> {
  return apiGet<Statement>(`${BASE}/statement${statementQuery(q)}`);
}

/**
 * The statement as a CSV, BOM included. The blob only: `Content-Disposition`
 * is not CORS-exposed, so the caller names the file (`statementFileName`).
 */
export function getStatementCsv(q: StatementQuery): Promise<Blob> {
  return apiGetBlob(`${BASE}/statement.csv${statementQuery(q)}`);
}

/** Superadmin only: every company's totals for the period. */
export function getCompanyRollup(range: {
  from: string;
  to: string;
}): Promise<CompanyRollup[]> {
  return apiGet<CompanyRollup[]>(
    `${BASE}/rollup${transactionQuery({ from: range.from, to: range.to })}`
  );
}

export interface ResendInput {
  /** Superadmin only. */
  companyId?: string;
  from?: string;
  to?: string;
  documentId?: string;
  /** Only documents whose email failed or was skipped. */
  onlyUnsent?: boolean;
}

/** Puts documents back in the queue; the server emails them within minutes. */
export function resendDocumentEmails(input: ResendInput): Promise<Requeued> {
  const sp = new URLSearchParams();
  if (input.companyId) sp.set("companyId", input.companyId);
  if (input.from) sp.set("from", input.from);
  if (input.to) sp.set("to", input.to);
  if (input.documentId) sp.set("documentId", input.documentId);
  if (input.onlyUnsent) sp.set("onlyUnsent", "true");
  const s = sp.toString();
  return apiPost<Requeued>(`${BASE}/email/resend${s ? `?${s}` : ""}`);
}

/** A file name for a downloaded statement: `statement-<label>-<from>-<to>.csv`. */
export function statementFileName(q: {
  partyLabel: string;
  from: string;
  to: string;
}): string {
  const slug = q.partyLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `statement-${slug || "account"}-${q.from}-${q.to}.csv`;
}
