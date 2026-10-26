import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu } from "lucide-react";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useMe, useSignOut } from "@/hooks/useAuth";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { useTicketStream } from "@/hooks/useTicketStream";
import { WorkspaceProvider } from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { FRANCHISE_WORKSPACE } from "@/services/workspace";
import { FRANCHISEE_NAME_TOKEN, FRANCHISE_ROUTE_META } from "./franchiseRouteMeta";
import { FranchiseSidebar } from "./FranchiseSidebar";

/**
 * The franchise surface — the franchisee admin's own desk (§5.6).
 *
 * A third shell beside `AppShell` and `VendorShell` — same rail, drawer, sticky
 * bar, no company switcher and no dead search box, for the reasons those two
 * already record (a franchise session has exactly one franchisee, and a search
 * wired to nothing is worse than absent). Sign out stays on the bar, for the
 * vendor-shelf reason: this person signs in, checks the queue, leaves.
 *
 * Two things only this shell does:
 *
 *   * **the `<h1>` from `franchiseRouteMeta`**. The pages reused from the staff
 *     console (technicians, redemptions, pool, ticket detail) render no heading
 *     of their own — they relied on `AppShell`'s topbar, which they are not
 *     under here, and an `<h2>` inside each page would mean editing the shared
 *     pages. Exactly one heading per page, rendered here.
 *   * **the `WorkspaceProvider`**. Everything reused below this line (the
 *     technician list, form, redemptions, pool) reads `useWorkspace()`, so the
 *     provider is what mounts them on the FRANCHISE workspace — the adapter
 *     pointing at `/franchise/*`. `AppShell` mounts none: ops is the default,
 *     which is what keeps the staff console untouched.
 */
export function FranchiseShell() {
  const { pathname } = useLocation();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed } = useSession();
  const { data: me, isPending } = useMe();
  const signOut = useSignOut();

  // Same two the vendor shell mounts — the bell and the portal feed were
  // reachable before, kept fresh only by their refetch intervals. The server
  // has always scoped a franchisee's feed (Task 05 addressed the kinds to its
  // admins); the socket just makes it arrive.
  useTicketStream();
  useNotificationToasts();

  // A route change must never leave the drawer open behind the new page.
  useEffect(() => setSidebarOpen(false), [pathname, setSidebarOpen]);

  // Escape closes the drawer — keyboard users need a way out.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setSidebarOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  const meta = FRANCHISE_ROUTE_META(pathname);
  // The header copy is a pure table, so the franchisee's NAME is substituted
  // here — the same indirection `routeMeta`'s `{escalationHours}` uses, and the
  // same reason: the table cannot know the session.
  const subtitle = meta.subtitle.replace(
    FRANCHISEE_NAME_TOKEN,
    me?.franchisee?.name ?? ""
  );

  return (
    <WorkspaceProvider value={FRANCHISE_WORKSPACE}>
      <div className="min-h-svh bg-background">
        {/* Desktop rail */}
        <div className="fixed inset-y-0 left-0 z-50 hidden md:block">
          <FranchiseSidebar collapsed={sidebarCollapsed} />
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSidebarOpen(false)}
                className="fixed inset-0 z-40 bg-[rgb(20_24_40/0.45)] md:hidden"
                aria-hidden
              />
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="fixed inset-y-0 left-0 z-50 md:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
              >
                {/* Never collapsed: the drawer is already an overlay. */}
                <FranchiseSidebar />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <div
          className={cn(
            "transition-[margin] duration-200",
            sidebarCollapsed ? "md:ml-sidebar-collapsed" : "md:ml-sidebar"
          )}
        >
          <header className="sticky top-0 z-30 flex h-topbar items-center gap-3.5 border-b border-line bg-surface px-4 md:px-5.5">
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu aria-hidden />
            </Button>

            {/* The one page heading — from the route's own meta. A reused page
                renders none of its own, so this is both the h1 and the visible
                header, exactly as `AppShell`'s topbar is for staff. */}
            <div className="min-w-0 shrink">
              <h1 className="truncate text-base leading-tight font-semibold">
                {meta.title}
              </h1>
              <p className="truncate text-xs text-ink-3">{subtitle}</p>
            </div>

            {/* Below `md` the rail is hidden, so the bar carries the identity
                the rail's header shows on a wide screen — the company then the
                franchisee, in §5.7's order (the franchisee is the second line
                everywhere). */}
            <div className="flex-1 md:hidden" />

            <div className="min-w-0 text-right leading-tight md:hidden">
              {isPending ? (
                <Skeleton className="ml-auto h-4 w-28" />
              ) : (
                <p className="truncate text-sm font-semibold text-ink">
                  {me?.franchisee?.name ?? ""}
                </p>
              )}
              <p className="truncate text-[11px] font-medium text-ink-3">
                {me?.activeCompany?.name ?? ""}
              </p>
            </div>

            <div className="flex-1 hidden md:block" />

            <ThemeToggle />
            <NotificationBell />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await signOut();
                // Hard redirect: a fresh document guarantees no in-memory
                // token or bfcache snapshot survives the sign-out.
                window.location.assign("/login");
              }}
            >
              <LogOut data-icon="inline-start" />
              Sign out
            </Button>
          </header>

          <main className="p-4 md:p-5.5">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}