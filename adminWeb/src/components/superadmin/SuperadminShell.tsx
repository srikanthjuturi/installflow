import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu } from "lucide-react";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useCurrentUser, useSignOut } from "@/hooks/useAuth";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { SuperadminBell } from "./SuperadminBell";
import { SuperadminSidebar } from "./SuperadminSidebar";

/**
 * The platform surface — the companies, and the geography they all share.
 *
 * Laid out like `AppShell` and `VendorShell`: a rail on the left, a drawer
 * below `md`, a sticky bar across the top. It began as a bare header, then grew
 * a row of tabs when Geography arrived — and a row of tabs reads as filter
 * chips rather than navigation, which is exactly why the vendor portal stopped
 * using them. The platform surface will keep gaining records that belong to
 * nobody's company, and the rail has room for them.
 *
 * Two things `AppShell` has that are deliberately absent:
 *
 *   * **the company switcher** — a superadmin holds no membership at all, so
 *     there is nothing to switch between.
 *   * **the search box** — `Topbar`'s input searches one company, and a
 *     superadmin has none to search.
 *
 * The bell is NOT `AppShell`'s: a notification belongs to a company and a
 * superadmin to none, so `SuperadminBell` lists the recharges waiting for a
 * decision instead, polled, because this surface has no socket either.
 *
 * Sign out stays on the bar rather than a click deep on an account page,
 * because this surface has no account page.
 */
export function SuperadminShell() {
  const { pathname } = useLocation();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed } = useSession();
  const user = useCurrentUser();
  const signOut = useSignOut();

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

  return (
    <div className="min-h-svh bg-background">
      {/* Desktop rail */}
      <div className="fixed inset-y-0 left-0 z-50 hidden md:block">
        <SuperadminSidebar collapsed={sidebarCollapsed} />
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
              {/* Never collapsed: the drawer is already an overlay, and an
                  icon-only overlay would be strictly worse than the full one. */}
              <SuperadminSidebar />
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

          {/* Below `md` the rail is hidden, so the bar carries the identity the
              rail's header shows on a wide screen — not both at once. */}
          <div className="min-w-0 leading-tight md:hidden">
            <p className="truncate text-sm font-semibold text-ink">
              {BRAND_NAME} Platform
            </p>
            <p className="truncate text-[11px] font-medium text-ink-3">
              Super Admin console
            </p>
          </div>

          <div className="flex-1" />

          {user ? (
            <span className="hidden text-xs text-ink-2 sm:inline">
              {user.email}
            </span>
          ) : null}
          <ThemeToggle />
          <SuperadminBell />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await signOut();
              // Hard redirect: a fresh document guarantees no in-memory token
              // or bfcache snapshot of the console survives the sign-out.
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
  );
}
