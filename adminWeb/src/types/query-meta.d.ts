import "@tanstack/react-query";

/**
 * Typed `meta` for every query and mutation.
 *
 * The global error toaster in `App.tsx` reads these two keys, so a call site
 * gets a compile error for a typo instead of silently losing its title.
 */
interface ApiCallMeta extends Record<string, unknown> {
  /** Which action failed — "Couldn't add the user". Becomes the toast title. */
  errorTitle?: string;
  /** Opt out of the global toast; only when the screen owns the message. */
  suppressErrorToast?: boolean;
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: ApiCallMeta;
    mutationMeta: ApiCallMeta;
  }
}
