import { NavLink, useLocation } from "react-router";
import { ChevronRight, Store } from "lucide-react";
import { SidebarCollapseToggle } from "@/components/shared/SidebarCollapseToggle";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureAccess, useMe } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { activePortalPath, portalNav } from "./portalNav";

/**
 * The portal's navigation rail.
 *
 * Same rail as the ops console's — same gradient, same widths, same active
 * treatment, same account footer — because a vendor is looking at the same
 * product and a second navigation idiom would be one to learn for no reason.
 * What differs is the contents: three destinations and no groups, against
 * fourteen in five groups.
 *
 * It does NOT reuse `shared/Sidebar`: that component reads `NAV_GROUPS`, and a
 * rail that merely filters the ops table is one `has(undefined)` away from
 * showing an outside party the escalation queue. Two tables, two rails, and the
 * portal's cannot name a screen it was not given.
 */
export function VendorSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { pathname } = useLocation();
  const { setSidebarOpen, toggleSidebarCollapsed } = useSession();
  const { data: me, isPending } = useMe();
  const { has } = useFeatureAccess();

  const items = portalNav(me?.vendor?.intakeChannels ?? []).filter((i) =>
    has(i.feature)
  );
  const active = activePortalPath(items, pathname);
  const accountActive = pathname === "/portal/account";
  const name = me?.user.fullName ?? me?.user.email ?? "";

  return (
    <aside
      className={cn(
        "bg-linear-180 from-(--sidebar-from) to-(--sidebar-to)",
        "flex h-full flex-col transition-[width] duration-200",
        collapsed ? "w-sidebar-collapsed" : "w-sidebar"
      )}
    >
      <div
        className={cn(
          "flex h-topbar shrink-0 items-center border-b border-white/10",
          collapsed ? "justify-center px-2" : "gap-3 px-5"
        )}
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-white text-brand-500">
          <Store className="size-4.5" aria-hidden />
        </div>
        {!collapsed && (
          // Both lines are facts from the server — the vendor's own name and
          // the company it supplies — so the rail says who you are without
          // inventing a strapline.
          <div className="min-w-0 flex-1 leading-tight">
            {me?.vendor?.name ? (
              <div className="truncate text-[13px] font-semibold text-white">
                {me.vendor.name}
              </div>
            ) : (
              <Skeleton className="h-3.5 w-24 bg-white/15" />
            )}
            <div className="truncate text-[11px] font-medium text-white/50">
              {me?.activeCompany?.name ?? ""}
            </div>
          </div>
        )}
        {!collapsed && (
          <SidebarCollapseToggle
            collapsed={collapsed}
            onToggle={toggleSidebarCollapsed}
          />
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center border-b border-white/10 py-2">
          <SidebarCollapseToggle
            collapsed={collapsed}
            onToggle={toggleSidebarCollapsed}
          />
        </div>
      )}

      <nav
        className={cn(
          "scroll-slim scroll-slim-invert flex-1 overflow-y-auto pt-3.5 pb-6",
          collapsed ? "px-2" : "px-3"
        )}
        aria-label="Portal"
      >
        {isPending
          ? // Reserve the rows so the rail does not jump once `/auth/me` lands
            // and this vendor's channels are known.
            [0, 1, 2].map((i) => (
              <Skeleton key={i} className="mb-0.5 h-9.5 bg-white/10" />
            ))
          : items.map((item) => {
              const isActive = item.to === active;
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  // Native tooltip when the label is hidden — the accessible
                  // name still comes from the text below, which stays in the
                  // DOM as sr-only rather than being removed.
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "relative mb-0.5 flex w-full items-center rounded-md py-2.5 text-[13px] transition-colors",
                    collapsed ? "justify-center px-0" : "gap-3 px-2.5",
                    isActive
                      ? "bg-white/15 font-semibold text-white"
                      : "font-medium text-white/70 hover:bg-white/8 hover:text-white"
                  )}
                >
                  <Icon
                    className="size-[18px] shrink-0"
                    strokeWidth={1.8}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      collapsed ? "sr-only" : "flex-1 truncate text-left"
                    )}
                  >
                    {item.label}
                  </span>
                </NavLink>
              );
            })}
      </nav>

      <div
        className={cn(
          "shrink-0 border-t border-white/10",
          collapsed ? "p-2" : "p-3"
        )}
      >
        {/* The way to your own record. `/portal/account` is ungated in
            PORTAL_UNGATED, so it is reachable whatever this vendor's features. */}
        <NavLink
          to="/portal/account"
          onClick={() => setSidebarOpen(false)}
          aria-current={accountActive ? "page" : undefined}
          title={collapsed ? `Account · ${name}` : undefined}
          className={cn(
            "flex w-full items-center rounded-md transition-colors",
            "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
            collapsed ? "justify-center p-1.5" : "gap-2.5 px-2.5 py-2",
            accountActive ? "bg-white/15" : "hover:bg-white/8"
          )}
        >
          <span className="sr-only">Account</span>
          <UserAvatar
            name={name}
            src={me?.user.profileImageUrl ?? null}
            className="size-8.5 bg-brand-400 text-[13px] text-white"
          />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13px] font-semibold text-white">
                  {name}
                </div>
                <div className="truncate text-[11px] text-white/50">
                  {me?.user.roleLabel ?? ""}
                </div>
              </div>
              <ChevronRight
                className="size-4 shrink-0 text-white/50"
                strokeWidth={1.8}
                aria-hidden
              />
            </>
          )}
        </NavLink>
      </div>
    </aside>
  );
}
