/**
 * Numbered transaction documents (Epic 1.5 - 1.7) - the wire shapes of
 * `api/app/features/transactions`. Amounts are PAISE integers, field names are
 * camelCase, and the server decides who may see what from the caller alone.
 */

export const DOC_TYPES = [
  "sales_invoice",
  "receipt",
  "payment",
  "debit_note",
  "credit_note",
  "purchase_note",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  sales_invoice: "Sales invoice",
  receipt: "Receipt",
  payment: "Payment",
  debit_note: "Debit note",
  credit_note: "Credit note",
  purchase_note: "Purchase note",
};

export const PARTY_KINDS = ["vendor", "franchisee", "technician", "platform"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const PARTY_KIND_LABELS: Record<PartyKind, string> = {
  vendor: "Vendor",
  franchisee: "Franchisee",
  technician: "Technician",
  platform: "Platform",
};

export type Effect = "debit" | "credit";

export const EMAIL_STATUSES = ["pending", "sent", "failed", "skipped"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  pending: "Pending",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
};

/** Shown as a tooltip on the `skipped` badge. */
export const EMAIL_SKIPPED_HINT =
  "Skipped: email not configured or no Admin with an email address.";

export interface TransactionDocument {
  id: string;
  /** e.g. `RGT-INV-0001`. */
  number: string;
  docType: DocType;
  companyId: string;
  companyName: string;
  partyKind: PartyKind;
  /** Null for the platform. */
  partyId: string | null;
  partyLabel: string;
  effect: Effect;
  amountPaise: number;
  ticketId: string | null;
  ticketCode: string | null;
  description: string;
  note: string | null;
  issuedAt: string;
  proofUrl: string | null;
  proofReference: string | null;
  relatedDocumentId: string | null;
  emailStatus: EmailStatus;
  emailedAt: string | null;
}

export interface TypeTotal {
  docType: DocType;
  count: number;
  totalPaise: number;
}

export interface TransactionSummary {
  byType: TypeTotal[];
  count: number;
  debitPaise: number;
  creditPaise: number;
  netPaise: number;
}

export interface PartyOption {
  partyKind: PartyKind;
  partyId: string | null;
  label: string;
}

export interface StatementLine {
  documentId: string;
  number: string;
  docType: DocType;
  issuedAt: string;
  description: string;
  reference: string | null;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
}

export interface Statement {
  companyId: string;
  companyName: string;
  partyKind: PartyKind;
  partyId: string | null;
  partyLabel: string;
  start: string;
  end: string;
  openingPaise: number;
  totalDebitPaise: number;
  totalCreditPaise: number;
  closingPaise: number;
  lines: StatementLine[];
}

export interface CompanyRollup {
  companyId: string;
  companyName: string;
  documents: number;
  debitPaise: number;
  creditPaise: number;
  netPaise: number;
}

export interface Requeued {
  queued: number;
}

/** The filters the list and the summary share. All optional; dates are IST days. */
export interface TransactionQuery {
  from?: string;
  to?: string;
  docType?: DocType;
  partyKind?: PartyKind;
  partyId?: string;
  /** Superadmin only. */
  companyId?: string;
  search?: string;
}

/**
 * Which column a document's amount belongs in. `debit` raises what the party
 * owes the company, `credit` reduces it - the server's `effect`, never inferred
 * from the document type.
 */
export function amountColumns(
  doc: Pick<TransactionDocument, "effect" | "amountPaise">
): { debitPaise: number | null; creditPaise: number | null } {
  return doc.effect === "debit"
    ? { debitPaise: doc.amountPaise, creditPaise: null }
    : { debitPaise: null, creditPaise: doc.amountPaise };
}

/**
 * A closing balance in plain words. Positive means the party owes the company;
 * negative means the company owes the party; zero is settled.
 */
export function balanceWording(closingPaise: number): {
  tone: "owes" | "owed" | "settled";
  phrase: string;
} {
  if (closingPaise > 0) return { tone: "owes", phrase: "owes the company" };
  if (closingPaise < 0) return { tone: "owed", phrase: "is owed by the company" };
  return { tone: "settled", phrase: "settled" };
}

export type TransactionSurface = "superadmin" | "company" | "vendor" | "franchise";

/** What each surface may see and do. One table, so the components never re-derive it. */
export interface SurfaceCaps {
  /** The company filter (superadmin spans companies). */
  companyFilter: boolean;
  /** Company name column. */
  companyColumn: boolean;
  /** Party kind + party filters. Hidden for a vendor: it is always itself. */
  partyFilter: boolean;
  /** Email status badge and re-send controls (company and platform only). */
  email: boolean;
  /** The all-companies roll-up (superadmin only). */
  rollup: boolean;
  /** The statement's party is fixed to the caller. */
  fixedParty: boolean;
  /** The party kind a fixed-party statement is about. */
  fixedKind: PartyKind | null;
}

export const SURFACE_CAPS: Record<TransactionSurface, SurfaceCaps> = {
  superadmin: {
    companyFilter: true,
    companyColumn: true,
    partyFilter: true,
    email: true,
    rollup: true,
    fixedParty: false,
    fixedKind: null,
  },
  company: {
    companyFilter: false,
    companyColumn: false,
    partyFilter: true,
    email: true,
    rollup: false,
    fixedParty: false,
    fixedKind: null,
  },
  vendor: {
    companyFilter: false,
    companyColumn: false,
    partyFilter: false,
    email: false,
    rollup: false,
    fixedParty: true,
    fixedKind: "vendor",
  },
  franchise: {
    companyFilter: false,
    companyColumn: false,
    partyFilter: true,
    email: false,
    rollup: false,
    fixedParty: true,
    fixedKind: "franchisee",
  },
};
