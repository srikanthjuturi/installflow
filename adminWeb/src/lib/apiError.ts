import { toast } from "@/components/ui/toast";
import { ApiError } from "@/services/client";

/**
 * One place that turns a thrown API failure into something a human reads.
 *
 * Every query and mutation failure in this console surfaces in the toaster —
 * wired once in `App.tsx` through the Query/Mutation caches, so no call site
 * has to remember. Screens never re-render the same message inline; the only
 * inline failure UI left is `ErrorState`, which fills the region a list would
 * have occupied and offers Retry.
 */

export interface ErrorMessage {
  title: string;
  description?: string;
}

/**
 * The title when the call site hasn't given one. Deliberately short — the
 * server's own sentence goes in the description, so this must not repeat it.
 */
function titleForStatus(status: number): string {
  if (status === 0) return "Network error";
  switch (status) {
    case 400:
    case 422:
      return "Check the details";
    case 401:
      return "Sign-in failed";
    case 403:
      return "Not allowed";
    case 404:
      return "Not found";
    case 409:
      return "Conflict";
    case 429:
      return "Too many requests";
    default:
      return status >= 500 ? "Server error" : "Request failed";
  }
}

/**
 * Normalises anything thrown — `ApiError`, a plain `Error`, or a non-error —
 * into a toast title and description.
 *
 * `fallbackTitle` is the caller's context ("Couldn't add the user"). It wins
 * over the status label because it says which action failed, which the status
 * alone never can.
 */
export function describeError(
  err: unknown,
  fallbackTitle?: string
): ErrorMessage {
  if (err instanceof ApiError) {
    // `errors[]` can echo `message`; show each sentence once.
    const detail = Array.from(
      new Set([err.message, ...err.errors].filter(Boolean))
    ).join(" · ");
    return {
      title: fallbackTitle ?? titleForStatus(err.status),
      description: detail || undefined,
    };
  }

  if (err instanceof Error) {
    return {
      title: fallbackTitle ?? "Something went wrong",
      description: err.message || undefined,
    };
  }

  return { title: fallbackTitle ?? "Something went wrong" };
}

/**
 * A dead backend fails every in-flight query at once, and they all carry the
 * same message. Collapse repeats inside this window so one outage is one
 * toast, not a stack of twelve.
 */
const DEDUPE_MS = 4_000;
const recent = new Map<string, number>();

function isRepeat(key: string): boolean {
  const now = Date.now();
  // Opportunistic sweep — the map only ever holds a handful of keys.
  for (const [k, at] of recent) {
    if (now - at > DEDUPE_MS) recent.delete(k);
  }
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

/** Shows an API failure in the toaster. Safe to call from anywhere. */
export function toastApiError(err: unknown, fallbackTitle?: string): void {
  const { title, description } = describeError(err, fallbackTitle);
  if (isRepeat(`${title}|${description ?? ""}`)) return;

  toast.add({
    type: "error",
    title,
    description,
    // Failures outlive a success confirmation: the user has to read the
    // reason, and may need it while re-typing the form behind the toast.
    timeout: 8_000,
    priority: "high",
  });
}
