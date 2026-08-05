/**
 * The API seam.
 *
 * Phase 1 (now): every service function resolves from `services/mocks/` through
 * `mockResponse`, so loading, empty and error states are real today.
 *
 * Phase 2 (Python backend): swap the body of `mockResponse` for a real `fetch`.
 * Nothing above this file — no hook, no component — changes.
 */

/** Simulated round-trip. Long enough that skeletons actually render. */
const LATENCY_MS = 320;

/** Flip to a number in (0,1) to exercise error states during development. */
const FAILURE_RATE = 0;

export class ApiError extends Error {
  /** Declared explicitly — `erasableSyntaxOnly` forbids parameter properties. */
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Resolves mock data as if it came off the wire.
 *
 * `data` is taken as a thunk so mock modules stay lazy and any per-call
 * derivation (filtering, sorting) runs at call time, not at import time.
 */
export function mockResponse<T>(data: () => T, latency = LATENCY_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (FAILURE_RATE > 0 && Math.random() < FAILURE_RATE) {
        reject(new ApiError("Mock failure — flip FAILURE_RATE to 0", 503));
        return;
      }
      try {
        resolve(data());
      } catch (err) {
        reject(
          err instanceof ApiError
            ? err
            : new ApiError(err instanceof Error ? err.message : "Unknown error"),
        );
      }
    }, latency);
  });
}

/** Thrown by detail services so a bad deep link renders a real 404 state. */
export function notFound(what: string, id: string): never {
  throw new ApiError(`${what} ${id} not found`, 404);
}
