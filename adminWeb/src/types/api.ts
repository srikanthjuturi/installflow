/**
 * The backend's response envelope.
 *
 * Every endpoint returns this shape — success and failure alike — so the
 * client never has to guess where the payload or the error text lives.
 */
export interface ApiEnvelope<T> {
  success: boolean;
  statusCode: number;
  message: string;
  /** ISO 8601, server clock. */
  timestamp: string;
  data: T;
  /** Populated on failure; empty array on success. */
  errors: string[];
}

/** List endpoints add this alongside `data`. */
export interface PaginationMeta {
  page: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedEnvelope<T> extends ApiEnvelope<T[]> {
  pagination: PaginationMeta;
}

/** What a list service hands back once the envelope is unwrapped. */
export interface Page<T> {
  rows: T[];
  pagination: PaginationMeta;
}

/** Query parameters every list endpoint accepts. */
export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** Domain filters, flattened into the query string. */
  filters?: Record<string, string>;
}

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/* ------------------------------------------------------------------ auth */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Numeric on the wire — see API_ROLE. */
  role: number;
  createdAt: string;
  lastLoginAt: string;
  loginCount: number;
}

export interface AuthPayload {
  accessToken: string;
  user: AuthUser;
}

/**
 * Numeric role codes.
 *
 * ⚠ ONLY `ADMIN: 1` is confirmed — it is the value in the sample response,
 * whose JWT carries `"role":"ADMIN"`. The other four are placeholders chosen
 * to match the console's own hierarchy and MUST be checked against the
 * backend before anything depends on them. Getting these wrong silently
 * grants or denies the wrong scope.
 */
export const API_ROLE = {
  ADMIN: 1,
  NH: 2,
  RSH: 3,
  ASM: 4,
  OPS_STAFF: 5,
} as const;

export type ApiRole = (typeof API_ROLE)[keyof typeof API_ROLE];

/* --------------------------------------------------- real backend auth ----
 * The live FastAPI backend speaks STRING roles (not the numeric codes above)
 * and adds a superadmin platform role plus the caller's company memberships.
 * These types describe `POST /auth/login`'s `data` block exactly. The numeric
 * `API_ROLE` above stays for the still-mocked ops-console screens.
 */

export type BackendRole =
  | "superadmin"
  | "admin"
  | "national_head"
  | "regional_head"
  | "area_manager"
  | "technician";

export interface BackendUser {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: BackendRole;
  roleLabel: string;
  profileImageUrl: string | null;
  isSuperadmin: boolean;
}

export interface BackendMembership {
  companyId: string;
  companyName: string;
  companySlug: string;
  role: BackendRole;
  isActive: boolean;
}

/** `POST /auth/login` payload (already unwrapped from the envelope). */
export interface LoginResponse {
  user: BackendUser;
  memberships: BackendMembership[];
  activeCompanyId: string | null;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}
