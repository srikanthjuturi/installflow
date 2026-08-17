import { NavLink, useLocation } from "react-router";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav";
import { ROLE_LABEL, useSession } from "@/store/session";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useFeatureAccess } from "@/hooks/useAuth";

function isActive(pathname: string, to: string, match?: string[]) {
  if (to === "/") return pathname === "/";
  if (pathname === to) return true;
  return match?.some((m) => pathname.startsWith(m)) ?? false;
}

/**
 * The navigation rail.
 *
 * `collapsed` shrinks it to icons so a dense table gets ~170px more width.
 * The drawer on mobile is never collapsed — it is already an overlay, and an
 * icon-only overlay would be strictly worse than the full one.
 */
export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { pathname } = useLocation();
  const {
    name,
    role,
    backendUser,
    avatarUrl,
    setSidebarOpen,
    toggleSidebarCollapsed,
  } = useSession();
  // Prefer the real backend role label; the mock `role` can drift from a stale
  // persisted session, so it's only a fallback for the still-mocked chrome.
  const roleLabel = backendUser?.roleLabel ?? ROLE_LABEL[role];

  // Two filters, then drop groups left empty:
  //   1. `roles` — the console's own coarse grouping (mock chrome).
  //   2. `feature` — the backend's effective feature set for this user in this
  //      company. A hidden link is also blocked by the route guard, and the
  //      server refuses the call regardless.
  const { has } = useFeatureAccess();
  const groups = NAV_GROUPS.filter((g) => !g.roles || g.roles.includes(role))
    .map((g) => ({ ...g, items: g.items.filter((i) => has(i.feature)) }))
    .filter((g) => g.items.length > 0);

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
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-white text-[15px] font-bold text-brand-500">
          IF
        </div>
        {!collapsed && (
          <div className="flex-1 truncate text-[15px] font-semibold text-white">
            InstallFlow
          </div>
        )}
        {!collapsed && (
          <CollapseToggle
            collapsed={collapsed}
            onToggle={toggleSidebarCollapsed}
          />
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center border-b border-white/10 py-2">
          <CollapseToggle
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
        aria-label="Main"
      >
        {groups.map((group) => (
          <div key={group.name} className="mb-4">
            {/* Collapsed, the group name has nowhere to go — but it still
                labels the group for assistive tech. */}
            <div
              className={cn(
                "pb-2 text-[10px] font-bold tracking-[0.09em] text-white/40 uppercase",
                collapsed ? "sr-only" : "px-2.5"
              )}
            >
              {group.name}
            </div>
            {group.items.map((item) => {
              const active = isActive(pathname, item.to, item.match);
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  aria-current={active ? "page" : undefined}
                  // Native tooltip when the label is hidden — the accessible
                  // name still comes from the text below, which stays in the
                  // DOM as sr-only rather than being removed.
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "relative mb-0.5 flex w-full items-center rounded-md py-2.5 text-[13px] transition-colors",
                    collapsed ? "justify-center px-0" : "gap-3 px-2.5",
                    active
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
                  {item.badge ? (
                    <span
                      className={cn(
                        "bg-brand-accent text-[10px] font-bold text-white",
                        collapsed
                          ? "absolute top-1 right-1 grid size-4 place-items-center rounded-full"
                          : "rounded-full px-1.5 py-px"
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "shrink-0 border-t border-white/10",
          collapsed ? "p-2" : "p-3"
        )}
      >
        {/* The way to your own record — and the only way to sign out. */}
        <NavLink
          to="/account"
          onClick={() => setSidebarOpen(false)}
          aria-current={isActive(pathname, "/account") ? "page" : undefined}
          title={collapsed ? `Account · ${name}` : undefined}
          className={cn(
            "flex w-full items-center rounded-md transition-colors",
            "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
            collapsed ? "justify-center p-1.5" : "gap-2.5 px-2.5 py-2",
            isActive(pathname, "/account") ? "bg-white/15" : "hover:bg-white/8"
          )}
        >
          <span className="sr-only">Account</span>
          <UserAvatar
            name={name}
            src={avatarUrl}
            className="size-8.5 bg-brand-400 text-[13px] text-white"
          />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13px] font-semibold text-white">
                  {name}
                </div>
                <div className="truncate text-[11px] text-white/50">
                  {roleLabel}
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

function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
    >
      <Icon className="size-4.5" strokeWidth={1.8} aria-hidden />
    </button>
  );
}
