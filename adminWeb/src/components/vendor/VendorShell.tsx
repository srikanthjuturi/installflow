import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu } from "lucide-react";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useMe, useSignOut } from "@/hooks/useAuth";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import { useTicketStream } from "@/hooks/useTicketStream";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { VendorSidebar } from "./VendorSidebar";

/**
 * The vendor surface — raise a ticket, follow it, manage your own people.
 *
 * Laid out like `AppShell`: a rail on the left, a drawer below `md`, a sticky
 * bar across the top. The destinations used to be a row of pills under the
 * header, which stopped fitting once a vendor with several intake channels had
 * more than a couple, and read as filter chips rather than navigation.
 *
 * Three things `AppShell` has that are deliberately absent:
 *
 *   * **the company switcher** — a vendor belongs to exactly one company, and
 *     that switcher already degrades to a static chip for a single membership.
 *     The rail's header already names the company.
 *   * **the notification bell** — still backed by a mock. A fabricated number
 *     on an external party's screen is not a placeholder, it is a lie.
 *   * **the search box** — `Topbar`'s input is wired to nothing. A new surface
 *     must not inherit a dead control.
 *
 * And one thing it adds: Sign out stays on the bar. The ops console hides it a
 * click deep on the account page, which is fine for staff who live here all
 * day; a vendor signs in to raise one ticket and leave.
 */
export function VendorShell() {
  const { pathname } = useLocation();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed } = useSession();
  const { data: me, isPending } = useMe();
  const signOut = useSignOut();

  // The portal had no live socket at all until now — the bell and
  // `/portal/notifications` were kept fresh only by the refetch interval under
  // them. The server has always scoped `notification.raised` to vendors
  // properly (`_visible` matches on `vendor_id`, and the socket's own
  // authentication already admits a vendor user), so this is the one line it
  // looks like: a vendor is told about the serial mismatches that name THEM
  // and about nothing else.
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

  return (
    <div className="min-h-svh bg-background">
      {/* Desktop rail */}
      <div className="fixed inset-y-0 left-0 z-50 hidden md:block">
        <VendorSidebar collapsed={sidebarCollapsed} />
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
              <VendorSidebar />
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
            {isPending ? (
              <Skeleton className="h-4 w-28" />
            ) : (
              <p className="truncate text-sm font-semibold text-ink">
                {me?.vendor?.name ?? ""}
              </p>
            )}
            <p className="truncate text-[11px] font-medium text-ink-3">
              {me?.activeCompany?.name ?? ""}
            </p>
          </div>

          <div className="flex-1" />

          <ThemeToggle />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await signOut();
              // Hard redirect: a fresh document guarantees no in-memory token
              // or bfcache snapshot survives the sign-out.
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
