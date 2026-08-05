import { NavLink, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav";
import { ROLE_LABEL, useSession } from "@/store/session";

function isActive(pathname: string, to: string, match?: string[]) {
  if (to === "/") return pathname === "/";
  if (pathname === to) return true;
  return match?.some((m) => pathname.startsWith(m)) ?? false;
}

export function Sidebar() {
  const { pathname } = useLocation();
  const { name, role, setSidebarOpen } = useSession();
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

  return (
    <aside
      className={cn(
        "bg-linear-180 from-(--sidebar-from) to-(--sidebar-to)",
        "flex h-full w-sidebar flex-col",
      )}
    >
      <div className="flex h-topbar shrink-0 items-center gap-3 border-b border-white/10 px-5">
        <div className="text-brand-500 grid size-8 place-items-center rounded-md bg-white text-[15px] font-bold">
          IF
        </div>
        <div className="text-[15px] font-semibold text-white">InstallFlow</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-3.5 pb-6" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.name} className="mb-4">
            <div className="px-2.5 pb-2 text-[10px] font-bold tracking-[0.09em] text-white/40 uppercase">
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
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-[13px] transition-colors",
                    active
                      ? "bg-white/15 font-semibold text-white"
                      : "font-medium text-white/70 hover:bg-white/8 hover:text-white",
                  )}
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
                  <span className="flex-1 truncate text-left">{item.label}</span>
                  {item.badge ? (
                    <span className="bg-brand-accent rounded-full px-1.5 py-px text-[10px] font-bold text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <div className="bg-brand-400 grid size-8.5 place-items-center rounded-full text-[13px] font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{name}</div>
            <div className="truncate text-[11px] text-white/50">{ROLE_LABEL[role]}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
