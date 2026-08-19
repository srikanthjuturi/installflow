import { Suspense } from "react";
import { NavLink, Outlet } from "react-router";
import { LogOut, Store } from "lucide-react";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useFeatureAccess, useMe, useSignOut } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { portalNav } from "./portalNav";

/**
 * The vendor surface — raise a ticket, follow it, manage your own people.
 *
 * Modelled on `SuperadminShell` rather than `AppShell`, and for the same
 * reason: a vendor has no dashboard, no escalation queue, no technicians and no
 * ledger, so a fourteen-item rail would be thirteen dead ends. Four
 * destinations fit a row under the header.
 *
 * Three things `AppShell` has that are deliberately absent:
 *
 *   * **the company switcher** — a vendor belongs to exactly one company, and
 *     that switcher already degrades to a static chip for a single membership.
 *     Two chips saying the same thing is worse than one.
 *   * **the notification bell** — still backed by a mock. A fabricated number
 *     on an external party's screen is not a placeholder, it is a lie.
 *   * **the search box** — `Topbar`'s input is wired to nothing. A new surface
 *     must not inherit a dead control.
 */
export function VendorShell() {
  const { data: me, isPending } = useMe();
  const { has } = useFeatureAccess();
  const signOut = useSignOut();

  const items = portalNav(me?.vendor?.intakeChannels ?? []).filter((i) =>
    has(i.feature)
  );

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="flex h-15 items-center justify-between px-4 md:px-5.5">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-md bg-brand-500 text-surface">
              <Store className="size-4.5" aria-hidden />
            </div>
            <div className="leading-tight">
              {/* Both lines are facts from the server — the vendor's own name
                  and the company it supplies — so the shell says who you are
                  without inventing a strapline. */}
              {/* The skeleton is a sibling, not a child: `Skeleton` renders a
                  <div>, and a <div> inside a <p> is invalid HTML that React
                  reports as a hydration error. */}
              {me?.vendor?.name ? (
                <p className="text-sm font-semibold text-ink">
                  {me.vendor.name}
                </p>
              ) : (
                <Skeleton className="h-4 w-28" />
              )}
              <p className="text-[11px] font-medium text-ink-3">
                {me?.activeCompany?.name ?? ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {me?.user.email ? (
              <span className="hidden text-xs text-ink-2 sm:inline">
                {me.user.email}
              </span>
            ) : null}
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
          </div>
        </div>

        <nav
          aria-label="Portal"
          className="scroll-slim flex gap-1 overflow-x-auto px-4 pb-2 md:px-5.5"
        >
          {isPending
            ? // Reserve the row's height so the header does not jump once
              // `/auth/me` lands and the channels are known.
              [0, 1].map((i) => <Skeleton key={i} className="h-8 w-28" />)
            : items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/portal/tickets"}
                  // Same active treatment as the DataTable filter pills, which
                  // is the console's existing answer for a selected control on
                  // a light surface. Nothing new invented for this shell.
                  className={({ isActive }) =>
                    cn(
                      "flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
                      isActive
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-line bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
                    )
                  }
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
        </nav>
      </header>

      <main className="p-4 md:p-5.5">
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
