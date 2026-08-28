import type {
  ApiEnvelope,
  ListParams,
  Page,
  PaginatedEnvelope,
  PaginationMeta,
} from "@/types/api";

/**
 * The API seam.
 *
 * Phase 1 (now): services resolve from `services/mocks/` but go through the
 * SAME envelope the backend returns — `{ success, statusCode, message,
 * timestamp, data, errors }`, plus `pagination` on list endpoints. Building
 * against the real shape now means binding later is a change of transport,
 * not of contract.
 *
 * Phase 2: `mockResponse` becomes `fetch`. `unwrap` / `unwrapPage` and every
 * hook and component above them stay exactly as they are.
 */

/** Simulated round-trip. Long enough that skeletons actually render. */
const LATENCY_MS = 320;

/** Flip to a number in (0,1) to exercise error states during development. */
const FAILURE_RATE = 0;

export class ApiError extends Error {
  /** Declared explicitly — `erasableSyntaxOnly` forbids parameter properties. */
  readonly status: number;
  /** The envelope's `errors[]`, for field-level messages. */
  readonly errors: string[];
  /**
   * The envelope's `code` — WHY, for the client rather than the user.
   *
   * Present only where one status carries more than one meaning and the screen
   * has to tell them apart: `POST /vendors` answers 409 for a duplicate name, a
   * duplicate GSTIN, the company's own GSTIN and a taken login email, and only
   * this says which. Never match on the status alone, and never on the prose.
   */
  readonly code?: string;

  constructor(
    message: string,
    status = 500,
    errors: string[] = [],
    code?: string
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

function envelope<T>(
  data: T,
  message = "Request processed successfully"
): ApiEnvelope<T> {
  return {
    success: true,
    statusCode: 200,
    message,
    timestamp: new Date().toISOString(),
    data,
    errors: [],
  };
}

/**
 * Resolves mock data inside the response envelope.
 *
 * `data` is a thunk so mock modules stay lazy and any per-call derivation
 * (filtering, sorting, slicing) runs at call time, not at import time.
 */
export function mockResponse<T>(
  data: () => T,
  latency = LATENCY_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (FAILURE_RATE > 0 && Math.random() < FAILURE_RATE) {
        reject(new ApiError("Mock failure — flip FAILURE_RATE to 0", 503));
        return;
      }
      try {
        // Wrapped then immediately unwrapped on purpose: the envelope is the
        // contract, and going through it here keeps the mock honest.
        resolve(unwrap(envelope(data())));
      } catch (err) {
        reject(toApiError(err));
      }
    }, latency);
  });
}

/** Same, for list endpoints — resolves rows plus the pagination block. */
export function mockPage<T>(
  rows: () => T[],
  params: ListParams = {},
  latency = LATENCY_MS
): Promise<Page<T>> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (FAILURE_RATE > 0 && Math.random() < FAILURE_RATE) {
        reject(new ApiError("Mock failure — flip FAILURE_RATE to 0", 503));
        return;
      }
      try {
        resolve(unwrapPage(paginate(rows(), params)));
      } catch (err) {
        reject(toApiError(err));
      }
    }, latency);
  });
}

/**
 * Builds the paginated envelope the backend would return.
 *
 * The slice happens HERE, standing in for the server. Once the real endpoint
 * exists this function disappears and the server does it — which is why no
 * component slices rows itself.
 */
export function paginate<T>(
  all: T[],
  params: ListParams = {}
): PaginatedEnvelope<T> {
  const limit = Math.max(1, params.limit ?? 20);
  const totalRecords = all.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
  // Clamp rather than return an empty page: a filter that shrinks the result
  // set must not strand the caller past the end.
  const page = Math.min(Math.max(1, params.page ?? 1), totalPages);

  const pagination: PaginationMeta = {
    page,
    limit,
    totalRecords,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };

  return {
    ...envelope(all.slice((page - 1) * limit, page * limit)),
    pagination,
  };
}

/** Reads the payload out of an envelope, or throws what the envelope reports. */
export function unwrap<T>(res: ApiEnvelope<T>): T {
  if (!res.success) {
    throw new ApiError(
      res.message || "Request failed",
      res.statusCode,
      res.errors,
      res.code
    );
  }
  return res.data;
}

export function unwrapPage<T>(res: PaginatedEnvelope<T>): Page<T> {
  return { rows: unwrap(res), pagination: res.pagination };
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(err instanceof Error ? err.message : "Unknown error");
}

/** Thrown by detail services so a bad deep link renders a real 404 state. */
export function notFound(what: string, id: string): never {
  throw new ApiError(`${what} ${id} not found`, 404);
}

/* ------------------------------------------------------------ mock helpers */

/** Case-insensitive match of a query across the given fields. */
export function matches<T>(
  row: T,
  keys: Array<keyof T>,
  query?: string
): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return keys.some((k) =>
    String(row[k] ?? "")
      .toLowerCase()
      .includes(q)
  );
}

/**
 * Sorts a copy. Sorting in place would mutate the module-level mock arrays,
 * so a sorted request would permanently reorder everyone else's data.
 */
export function sortRows<T>(
  rows: T[],
  sortBy: string | undefined,
  sortDir: "asc" | "desc" | undefined,
  getters: Record<string, (row: T) => string | number | null>
): T[] {
  if (!sortBy || !getters[sortBy]) return rows;
  const get = getters[sortBy];
  const dir = sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av === bv) return 0;
    if (av === null) return 1; // nulls last in both directions
    if (bv === null) return -1;
    if (typeof av === "number" && typeof bv === "number")
      return (av - bv) * dir;
    return (
      String(av).localeCompare(String(bv), "en-IN", { numeric: true }) * dir
    );
  });
}
