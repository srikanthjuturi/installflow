import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PageSkeleton } from "./PageSkeleton";
import { PAGE_META } from "./routeMeta";
import { useSession } from "@/store/session";

export function AppShell() {
  const { pathname } = useLocation();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed } = useSession();
  const meta = PAGE_META(pathname);

  // A route change must never leave the drawer open behind the new page.
  useEffect(() => setSidebarOpen(false), [pathname, setSidebarOpen]);

  // Escape closes the drawer — keyboard users need a way out.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSidebarOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <div className="bg-background min-h-svh">
      {/* Desktop rail */}
      <div className="fixed inset-y-0 left-0 z-50 hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} />
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
              <Sidebar />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className={cn("transition-[margin] duration-200", sidebarCollapsed ? "md:ml-sidebar-collapsed" : "md:ml-sidebar")}>
        <Topbar title={meta.title} subtitle={meta.subtitle} />
        {/* Fluid — the console is a work surface, so a wide monitor should
            buy more table, not more margin. */}
        <main className="p-4 md:p-5.5">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
