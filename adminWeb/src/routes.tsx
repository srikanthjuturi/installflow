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
const EscalationQueuePage = lazy(
  () => import("@/pages/escalations/EscalationQueuePage")
);
const ValidationResultPage = lazy(
  () => import("@/pages/tickets/ValidationResultPage")
);
const ForceClosePage = lazy(() => import("@/pages/tickets/ForceClosePage"));
const BonusSetupPage = lazy(() => import("@/pages/escalations/BonusSetupPage"));
const ManualAssignPage = lazy(
  () => import("@/pages/escalations/ManualAssignPage")
);
const LedgerPage = lazy(() => import("@/pages/ledger/LedgerPage"));
const VendorsPage = lazy(() => import("@/pages/masters/VendorsPage"));
const CategoriesPage = lazy(() => import("@/pages/masters/CategoriesPage"));
const TerritoryPage = lazy(() => import("@/pages/masters/TerritoryPage"));
const RulesConfigPage = lazy(() => import("@/pages/settings/RulesConfigPage"));
const UsersRolesPage = lazy(() => import("@/pages/settings/UsersRolesPage"));
const AccountPage = lazy(() => import("@/pages/account/AccountPage"));
const NotificationsPage = lazy(
  () => import("@/pages/notifications/NotificationsPage")
);
const TechnicianListPage = lazy(
  () => import("@/pages/technicians/TechnicianListPage")
);
const TechnicianProfilePage = lazy(
  () => import("@/pages/technicians/TechnicianProfilePage")
);
const AiQueuePage = lazy(() => import("@/pages/ai-review/AiQueuePage"));
const AiReviewDetailPage = lazy(
  () => import("@/pages/ai-review/AiReviewDetailPage")
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
          {
            path: "tickets/import/:batchId",
            element: <ValidationResultPage />,
          },
          { path: "tickets/:id", element: <TicketDetailPage /> },
          { path: "tickets/:id/force-close", element: <ForceClosePage /> },
          { path: "escalations", element: <EscalationQueuePage /> },
          { path: "escalations/:id/bonus", element: <BonusSetupPage /> },
          { path: "escalations/:id/assign", element: <ManualAssignPage /> },
          { path: "ai-review", element: <AiQueuePage /> },
          { path: "ai-review/:id", element: <AiReviewDetailPage /> },
          { path: "technicians", element: <TechnicianListPage /> },
          { path: "technicians/:id", element: <TechnicianProfilePage /> },
          { path: "ledger", element: <LedgerPage /> },
          { path: "vendors", element: <VendorsPage /> },
          { path: "categories", element: <CategoriesPage /> },
          { path: "territory", element: <TerritoryPage /> },
          { path: "settings/rules", element: <RulesConfigPage /> },
          { path: "settings/users", element: <UsersRolesPage /> },
          { path: "notifications", element: <NotificationsPage /> },
          { path: "account", element: <AccountPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
];
