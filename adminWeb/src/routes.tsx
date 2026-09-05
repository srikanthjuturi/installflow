import { lazy } from "react";
import { Navigate, Outlet, useLocation, type RouteObject } from "react-router";
/* The one page that is NOT lazy — see the route table's `*` entry. It is the
   fallback for every unmatched URL, including the one you land on when a stale
   chunk 404s, and a fallback that must fetch a chunk of its own can fail in
   exactly the situation it exists for. */
import NotFoundPage from "@/pages/NotFoundPage";
import { AppShell } from "@/components/shared/AppShell";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { featureForPath } from "@/components/shared/nav";
import { SuperadminShell } from "@/components/superadmin/SuperadminShell";
import { VendorShell } from "@/components/vendor/VendorShell";
import {
  PORTAL_UNGATED,
  featureForPortalPath,
} from "@/components/vendor/portalNav";
import { useFeatureAccess } from "@/hooks/useAuth";
import { landingPath, useSession } from "@/store/session";

/* Route-based code splitting — each page is its own chunk, resolved behind
   the AppShell's Suspense boundary. */
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const ForgotPasswordPage = lazy(
  () => import("@/pages/auth/ForgotPasswordPage")
);
const DashboardPage = lazy(() => import("@/pages/dashboard/DashboardPage"));
const TicketListPage = lazy(() => import("@/pages/tickets/TicketListPage"));
const TicketDetailPage = lazy(() => import("@/pages/tickets/TicketDetailPage"));
const EscalationQueuePage = lazy(
  () => import("@/pages/escalations/EscalationQueuePage")
);
const ForceClosePage = lazy(() => import("@/pages/tickets/ForceClosePage"));
const AssignTechnicianPage = lazy(
  () => import("@/pages/tickets/AssignTechnicianPage")
);
const BonusSetupPage = lazy(() => import("@/pages/tickets/BonusSetupPage"));
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
const TechnicianJobsPage = lazy(
  () => import("@/pages/technicians/TechnicianJobsPage")
);
/* AI review is hidden until the slice is built — see `nav.ts`. Commented, not
   deleted: the pages match the approved prototype and come straight back. */
// const AiQueuePage = lazy(() => import("@/pages/ai-review/AiQueuePage"));
// const AiReviewDetailPage = lazy(
//   () => import("@/pages/ai-review/AiReviewDetailPage")
// );
const CompaniesPage = lazy(() => import("@/pages/superadmin/CompaniesPage"));
const GeographyPage = lazy(() => import("@/pages/superadmin/GeographyPage"));
const ChangePasswordPage = lazy(
  () => import("@/pages/account/ChangePasswordPage")
);
const VendorTicketsPage = lazy(
  () => import("@/pages/vendor/VendorTicketsPage")
);
const VendorNewTicketPage = lazy(
  () => import("@/pages/vendor/VendorNewTicketPage")
);
const VendorUsersPage = lazy(() => import("@/pages/vendor/VendorUsersPage"));

/**
 * The escalation queue's two action screens moved under `/tickets/:id/…` when
 * it bound to the API, because their `:id` changed meaning: the mock keyed its
 * rows by ticket CODE (`RGT-INST-0008`) and these now take the ticket's UUID.
 *
 * A redirect rather than a deletion, and hard rule 0a is why: removing a route
 * does not close a path, it opens one — `RequireFeature` passes anything the
 * nav table does not name, so an unmatched `/escalations/:id/bonus` would fall
 * through to the 404 page having been waved past the feature check. It also
 * keeps a bookmark or a pasted link working, and there is no shape of old id
 * that is dangerous here: an unknown UUID reads 404 from the API, and a stale
 * ticket code reads the same.
 */
function RedirectToTicket({ to }: { to: "assign" | "bonus" }) {
  const { pathname } = useLocation();
  const id = pathname.split("/")[2] ?? "";
  return <Navigate to={`/tickets/${id}/${to}`} replace />;
}

function RequireAuth() {
  const signedIn = useSession((s) => s.signedIn);
  const superadmin = useSession((s) => s.superadmin);
  const portal = useSession((s) => s.portal);
  if (!signedIn) return <Navigate to="/login" replace />;
  // The superadmin console is a separate surface — keep it out of the ops app.
  if (superadmin) return <Navigate to="/companies" replace />;
  // And so is the vendor portal. Bouncing HERE, before `AppShell` mounts, is
  // what keeps a vendor away from the ungated ops screens: `has(undefined)` is
  // true, so `/`, `/escalations`, `/notifications` and `/account` would all
  // wave one through if they were ever reached. They never are.
  if (portal) return <Navigate to="/portal" replace />;
  return <Outlet />;
}

function RequirePortal() {
  const signedIn = useSession((s) => s.signedIn);
  const superadmin = useSession((s) => s.superadmin);
  const portal = useSession((s) => s.portal);
  if (!signedIn) return <Navigate to="/login" replace />;
  if (superadmin) return <Navigate to="/companies" replace />;
  if (!portal) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * The portal's feature guard — the OPPOSITE polarity to `RequireFeature`.
 *
 * There, a path the table does not know is ungated and passes. Here it is
 * denied. `has(undefined)` returns true, so "not in the table" has to mean "no"
 * or a single missing entry becomes a hole; the handful of genuinely open paths
 * are named in `PORTAL_UNGATED` instead.
 */
function RequirePortalFeature() {
  const { pathname } = useLocation();
  const { loading, has } = useFeatureAccess();
  if (PORTAL_UNGATED.has(pathname)) return <Outlet />;
  if (loading) return <PageSkeleton />;
  const feature = featureForPortalPath(pathname);
  return feature && has(feature) ? (
    <Outlet />
  ) : (
    <Navigate to="/portal/tickets" replace />
  );
}

function RequireSuperadmin() {
  const signedIn = useSession((s) => s.signedIn);
  const superadmin = useSession((s) => s.superadmin);
  if (!signedIn) return <Navigate to="/login" replace />;
  if (!superadmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * Blocks a route whose backing feature this user does not have, sending them to
 * the dashboard rather than a screen whose every request would 403. Pairs with
 * the sidebar filter — both read the same map, so a hidden link is also an
 * unreachable URL. The server remains the authority.
 */
function RequireFeature() {
  const { pathname } = useLocation();
  const feature = featureForPath(pathname);
  const { loading, has } = useFeatureAccess();

  // Ungated routes (dashboard, account, notifications) never wait on /auth/me.
  if (!feature) return <Outlet />;
  // Don't bounce anyone before the feature set has actually arrived.
  if (loading) return <PageSkeleton />;
  return has(feature) ? <Outlet /> : <Navigate to="/" replace />;
}

function RedirectIfSignedIn() {
  const signedIn = useSession((s) => s.signedIn);
  const superadmin = useSession((s) => s.superadmin);
  const portal = useSession((s) => s.portal);
  if (!signedIn) return <Outlet />;
  return <Navigate to={landingPath({ superadmin, portal })} replace />;
}

export const routes: RouteObject[] = [
  {
    element: <RedirectIfSignedIn />,
    children: [
      { path: "/login", element: <LoginPage /> },
      // Signed-out by definition, so it belongs under this guard and not
      // beside `/account/password`: somebody who still has a session has a
      // current password to type and should be sent to that screen instead.
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
    ],
  },
  {
    element: <RequireSuperadmin />,
    children: [
      {
        element: <SuperadminShell />,
        children: [
          { path: "companies", element: <CompaniesPage /> },
          // The geography every company shares — a platform record, not a
          // tenant one, which is why it lives on this surface and not under
          // Master Data in the ops app.
          { path: "geography", element: <GeographyPage /> },
        ],
      },
    ],
  },
  {
    element: <RequirePortal />,
    children: [
      {
        element: <VendorShell />,
        children: [
          // Outside the feature guard: it only redirects, and putting it inside
          // would mean naming it in the ungated set for no benefit.
          { path: "portal", element: <Navigate to="/portal/tickets" replace /> },
          {
            element: <RequirePortalFeature />,
            children: [
              { path: "portal/tickets", element: <VendorTicketsPage /> },
              { path: "portal/tickets/new", element: <VendorNewTicketPage /> },
              {
                path: "portal/tickets/:id",
                element: <TicketDetailPage backTo="/portal/tickets" actions={null} />,
              },
              { path: "portal/users", element: <VendorUsersPage /> },
              // The bell is in the shared Topbar, so a vendor has always been
              // able to see it. Without this route it linked into the ops tree,
              // where `RequireOps` bounced them straight back to /portal — a
              // control that could only ever throw them out of the page.
              { path: "portal/notifications", element: <NotificationsPage /> },
              { path: "portal/account", element: <AccountPage /> },
              { path: "portal/password", element: <ChangePasswordPage /> },
            ],
          },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            // Every in-app page sits behind the feature guard; ungated paths
            // pass straight through.
            element: <RequireFeature />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "tickets", element: <TicketListPage /> },
              // Explicit redirects, not just deleted routes: `/tickets/new`
              // otherwise MATCHES `tickets/:id` with id="new", so an old
              // bookmark renders the detail screen for a ticket called "new"
              // and 422s. A static segment outranks a dynamic one, so these
              // win wherever they are declared.
              {
                path: "tickets/new",
                element: <Navigate to="/tickets" replace />,
              },
              {
                path: "tickets/import",
                element: <Navigate to="/tickets" replace />,
              },
              { path: "tickets/:id", element: <TicketDetailPage /> },
              { path: "tickets/:id/force-close", element: <ForceClosePage /> },
              // Both escalation actions are ticket-scoped: an escalation IS a
              // ticket, and there is now one assignment screen rather than a
              // live one here and the mock queue's copy under /escalations.
              {
                path: "tickets/:id/assign",
                element: <AssignTechnicianPage />,
              },
              { path: "tickets/:id/bonus", element: <BonusSetupPage /> },
              { path: "escalations", element: <EscalationQueuePage /> },
              // Where those two used to live. See `RedirectToTicket`.
              {
                path: "escalations/:id/bonus",
                element: <RedirectToTicket to="bonus" />,
              },
              {
                path: "escalations/:id/assign",
                element: <RedirectToTicket to="assign" />,
              },
              /* Hidden with the rail entry. Unlike the escalation paths above,
                 these need no redirect: the screens were never gated by a
                 feature key, so removing them opens nothing — `/ai-review`
                 simply falls through to the 404 page, which is the truth. */
              // { path: "ai-review", element: <AiQueuePage /> },
              // { path: "ai-review/:id", element: <AiReviewDetailPage /> },
              { path: "technicians", element: <TechnicianListPage /> },
              { path: "technicians/:id", element: <TechnicianProfilePage /> },
              {
                path: "technicians/:id/tickets",
                element: <TechnicianJobsPage />,
              },
              { path: "ledger", element: <LedgerPage /> },
              { path: "vendors", element: <VendorsPage /> },
              { path: "categories", element: <CategoriesPage /> },
              { path: "territory", element: <TerritoryPage /> },
              { path: "settings/rules", element: <RulesConfigPage /> },
              { path: "settings/users", element: <UsersRolesPage /> },
              { path: "notifications", element: <NotificationsPage /> },
              { path: "account", element: <AccountPage /> },
              { path: "account/password", element: <ChangePasswordPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];
