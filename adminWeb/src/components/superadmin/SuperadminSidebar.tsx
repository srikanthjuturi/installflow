import { NavLink, useLocation } from "react-router";
import { Building2 } from "lucide-react";
import { SidebarCollapseToggle } from "@/components/shared/SidebarCollapseToggle";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { SUPERADMIN_NAV, activeSuperadminPath } from "./superadminNav";

/**
 * The platform console's navigation rail.
 *
 * Same rail as the ops console's and the vendor portal's — same gradient, same
 * widths, same active treatment, same account footer — because it is the same
 * product and a third navigation idiom would be one more to learn for no
 * reason. What differs is the contents: two destinations and no groups.
 *
 * It does NOT reuse `shared/Sidebar`, for the reason `VendorSidebar` gives:
 * that component reads `NAV_GROUPS` and filters on `useFeatureAccess`, and
 * `has(undefined)` returns TRUE — so a rail built by filtering the ops table
 * would happily show a superadmin the escalation queue and the ticket list,
 * neither of which they have a company to look at. This rail can only name a
 * screen `SUPERADMIN_NAV` was given.
 *
 * There is deliberately no feature filtering here at all: a superadmin holds no
 * membership, so `require_feature` on the API refuses them outright and
 * `SUPERADMIN_FEATURES` is a fixed list. The surface is gated once, by
 * `RequireSuperadmin` in `routes.tsx`.
 */
export function SuperadminSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { pathname } = useLocation();
  const { setSidebarOpen, toggleSidebarCollapsed } = useSession();
  const { data: me, isPending } = useMe();

  const active = activeSuperadminPath(pathname);
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
          // Tighter than the vendor rail's px-5/gap-3: "Videocon Platform"
          // is a fixed string and overflowed 236px by a couple of characters,
          // truncating to "Videocon Platfo…".
          collapsed ? "justify-center px-2" : "gap-2.5 px-3.5"
        )}
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-white text-brand-500">
          <Building2 className="size-4.5" aria-hidden />
        </div>
        {!collapsed && (
          // No company line here, unlike the vendor rail: a superadmin belongs
          // to none. The second line names the surface instead.
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold text-white">
              Videocon Platform
            </div>
            <div className="truncate text-[11px] font-medium text-white/50">
              Super Admin console
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
        aria-label="Superadmin"
      >
        {SUPERADMIN_NAV.map((item) => {
          const isActive = item.to === active;
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              aria-current={isActive ? "page" : undefined}
              // Native tooltip when the label is hidden — the accessible name
              // still comes from the text below, which stays in the DOM as
              // sr-only rather than being removed.
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative mb-0.5 flex w-full items-center rounded-md py-2.5 text-[13px] transition-colors",
                collapsed ? "justify-center px-0" : "gap-3 px-2.5",
                isActive
                  ? "bg-white/15 font-semibold text-white"
                  : "font-medium text-white/70 hover:bg-white/8 hover:text-white"
              )}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
              <span
                className={cn(collapsed ? "sr-only" : "flex-1 truncate text-left")}
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
        {/* A block, not a link — unlike the other two rails. There is no
            account route on this surface (`routes.tsx` gives a superadmin only
            Companies and Geography), and a footer that looks clickable and is
            not is worse than one that plainly reports who is signed in. */}
        <div
          className={cn(
            "flex w-full items-center rounded-md",
            collapsed ? "justify-center p-1.5" : "gap-2.5 px-2.5 py-2"
          )}
        >
          <UserAvatar
            name={name}
            src={me?.user.profileImageUrl ?? null}
            className="size-8.5 bg-brand-400 text-[13px] text-white"
          />
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              {isPending ? (
                <Skeleton className="h-3.5 w-24 bg-white/15" />
              ) : (
                <div className="truncate text-[13px] font-semibold text-white">
                  {name}
                </div>
              )}
              <div className="truncate text-[11px] text-white/50">
                {me?.user.roleLabel ?? ""}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
