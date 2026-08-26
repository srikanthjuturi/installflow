import { Suspense, useEffect } from "react";
import { BrowserRouter, useRoutes } from "react-router";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { routes } from "./routes";
import { Toaster, ToastProvider } from "@/components/ui/toast";
import { ApiError } from "@/services/client";
import { toastApiError } from "@/lib/apiError";
import { dismissBootSplash } from "@/lib/bootSplash";

/**
 * Every API failure — query or mutation — is reported in the toaster from
 * here. Doing it in the caches rather than per hook means a new screen gets
 * error reporting for free and can never forget it; a call site only adds
 * `meta.errorTitle` to say which action failed, or `meta.suppressErrorToast`
 * when a screen genuinely owns the message itself.
 */
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.suppressErrorToast) return;
      toastApiError(error, query.meta?.errorTitle);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.suppressErrorToast) return;
      toastApiError(error, mutation.meta?.errorTitle);
    },
  }),
  defaultOptions: {
    queries: {
      // Lists tolerate a little staleness; escalations and the AI queue
      // override this per-hook because they are time-sensitive.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 404 or a 403 will not become true on the second ask — retrying
      // only delays the error state the user needs to see.
      retry: (failureCount, error) => {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});

function Routes() {
  return useRoutes(routes);
}

export function App() {
  // Takes down the index.html splash. Here rather than in main.tsx because an
  // effect is the first thing that runs after React has actually committed —
  // see lib/bootSplash.ts.
  useEffect(() => {
    dismissBootSplash();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          {/*
            * No fallback here, deliberately.
            *
            * This is the OUTERMOST boundary — it catches a lazy page that has
            * no shell around it yet, which in practice means the login screen.
            * A generic toolbar-and-panel skeleton is the wrong shape for a
            * split brand panel and a sign-in form, and reads as clumsy rather
            * than as loading.
            *
            * Nothing is lost by leaving it empty: the boot splash in index.html
            * is still on top at this point and stays until #root actually holds
            * a page, so the sequence is splash → the real screen, with no
            * shape-shifting in between. The shells keep their own PageSkeleton,
            * where it belongs — there the chrome is already on screen and the
            * skeleton stands in for a page inside it.
            */}
          <Suspense fallback={null}>
            <Routes />
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
