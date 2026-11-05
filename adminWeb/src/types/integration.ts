/**
 * The vendor CRM API's console side — credentials and the call log.
 *
 * Mirrors `api/app/features/api_credentials/schemas.py`. A credential belongs to
 * ONE vendor; a CRM that holds it acts for that vendor and nobody else.
 *
 * **A secret appears in exactly one shape here: `CreatedApiCredential`.** The
 * list shape (`ApiCredential`) has no secret field at all, so a screen that
 * draws a row cannot print one by mistake.
 */

import type { EmailStatus } from "./user";

export type CredentialStatus = "Active" | "Revoked";

/** One row of the credentials list. Never carries a secret. */
export interface ApiCredential {
  id: string;
  vendorId: string;
  vendorName: string;
  /** Public, like a username — `<vendor-slug>_<3 digits>`. */
  clientId: string;
  note: string | null;
  status: CredentialStatus;
  createdAt: string;
  /** Last successful call; null until the CRM has used it. */
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Set when this credential was made with Replace. */
  replacesId: string | null;
}

/**
 * The response to creating or replacing a credential.
 *
 * `clientSecret` is in THIS response only — the server keeps a hash and cannot
 * show it again. It is also emailed to the vendor's primary login;
 * `emailStatus` says whether that worked, so the admin knows if this screen is
 * the only copy anybody has.
 */
export interface CreatedApiCredential {
  credential: ApiCredential;
  clientSecret: string;
  emailStatus: EmailStatus;
  emailError: string | null;
}

export interface CreateApiCredentialInput {
  vendorId: string;
  /** Optional label such as "Production CRM", at most 120 characters. */
  note?: string | null;
}

/** The endpoints a CRM can call, as the call log names them. */
export const API_LOG_ENDPOINTS = [
  "token",
  "create_ticket",
  "get_ticket",
  "list_tickets",
] as const;
export type ApiLogEndpoint = (typeof API_LOG_ENDPOINTS)[number];

export const API_LOG_ENDPOINT_LABELS: Record<ApiLogEndpoint, string> = {
  token: "Get token",
  create_ticket: "Create ticket",
  get_ticket: "Read ticket",
  list_tickets: "List tickets",
};

/** One call a CRM made with a KNOWN credential. */
export interface ApiLogEntry {
  id: string;
  occurredAt: string;
  vendorName: string;
  clientId: string;
  endpoint: ApiLogEndpoint;
  httpStatus: number;
  /** The stable error code, or null on success. */
  outcomeCode: string | null;
  reference: string | null;
  checkOnly: boolean;
  /** True when an existing ticket was returned instead of a new one. */
  repeat: boolean;
  ticketId: string | null;
  /**
   * The redacted request summary. **Null once the 30-day details window has
   * passed** — the row itself stays for a year. Never holds a secret or token.
   */
  summary: Record<string, unknown> | null;
}

/** The query the logs screen sends; every key is optional. */
export interface ApiLogFilters {
  vendorId?: string;
  credentialId?: string;
  endpoint?: ApiLogEndpoint;
  outcome?: "ok" | "error";
  /** ISO dates. */
  from?: string;
  to?: string;
}
