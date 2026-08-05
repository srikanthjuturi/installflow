import { Suspense } from "react";
import { BrowserRouter, useRoutes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routes } from "./routes";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { ApiError } from "@/services/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Lists tolerate a little staleness; escalations and the AI queue
      // override this per-hook because they are time-sensitive.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 404 or a 403 will not become true on the second ask — retrying
      // only delays the error state the user needs to see.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
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
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageSkeleton />}>
          <Routes />
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
