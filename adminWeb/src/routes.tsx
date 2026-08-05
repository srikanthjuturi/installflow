import { lazy } from "react";
import { Navigate, Outlet, type RouteObject } from "react-router";
import { AppShell } from "@/components/shared/AppShell";
import { useSession } from "@/store/session";

/* Route-based code splitting — each page is its own chunk, resolved behind
   the AppShell's Suspense boundary. */
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const DashboardPage = lazy(() => import("@/pages/dashboard/DashboardPage"));
const TicketListPage = lazy(() => import("@/pages/tickets/TicketListPage"));
const TicketDetailPage = lazy(() => import("@/pages/tickets/TicketDetailPage"));
const ManualEntryPage = lazy(() => import("@/pages/tickets/ManualEntryPage"));
const BulkUploadPage = lazy(() => import("@/pages/tickets/BulkUploadPage"));
const ValidationResultPage = lazy(
  () => import("@/pages/tickets/ValidationResultPage"),
);

function RequireAuth() {
  const signedIn = useSession((s) => s.signedIn);
  return signedIn ? <Outlet /> : <Navigate to="/login" replace />;
}

function RedirectIfSignedIn() {
  const signedIn = useSession((s) => s.signedIn);
  return signedIn ? <Navigate to="/" replace /> : <Outlet />;
}

export const routes: RouteObject[] = [
  {
    element: <RedirectIfSignedIn />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "tickets", element: <TicketListPage /> },
          { path: "tickets/new", element: <ManualEntryPage /> },
          { path: "tickets/import", element: <BulkUploadPage /> },
          { path: "tickets/import/:batchId", element: <ValidationResultPage /> },
          { path: "tickets/:id", element: <TicketDetailPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
];
