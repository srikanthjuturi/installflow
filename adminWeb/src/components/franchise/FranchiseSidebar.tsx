import { NavLink, useLocation } from "react-router";
import { ChevronRight } from "lucide-react";
import { BrandMark } from "@/components/shared/BrandMark";
import { SidebarCollapseToggle } from "@/components/shared/SidebarCollapseToggle";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeatureAccess, useMe } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { usePartRequestCounts } from "@/hooks/useParts";
import { useRedemptionsBadge } from "@/hooks/useRedemptions";
import { useUpiChangesBadge } from "@/hooks/useFranchise";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { activeFranchisePath, franchiseNav } from "./franchiseNav";

/**
 * The franchise portal's navigation rail — the twin of `vendor/VendorSidebar`,
 * and read that file's header, because every reason there applies here again
 * for a third surface: same gradient, same widths, same active treatment, same
 * account footer, because a franchisee admin is looking at the same product.
 *
 * It does NOT reuse `shared/Sidebar`: that component reads `NAV_GROUPS` with a
 * required `feature` on every entry, and a rail that merely filters the staff
 * table is one `has(undefined)` from showing an outside party the escalation
 * queue (`vendor/portalNav.ts` covers the same trap). Two tables, two rails —
 * this one cannot name a screen it was not given.
 *
 * Two things differ from the vendor rail, both §5.7:
 *
 *   * the header is the company's **`BrandMark`** tile, not a store icon — an
 *     external franchisee leases the company's name (F1/F11), so its own name
 *     stays the SECOND line and never replaces the brand;
 *   * it carries badges: the redemptions "to pay" count, the UPI changes
 *     waiting on this franchisee and (Task 13) the spare-part requests waiting
 *     on its desk. All read the portal's OWN doors, so they
 *     must be called inside the shell's provider — which they are, because the
 *     shell renders this rail; badges with zero or not held are not drawn
 *     (same rule `AppShell`'s rail follows).
 */
export function FranchiseSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { pathname } = useLocation();
  const { setSidebarOpen, toggleSidebarCollapsed } = useSession();
  const { data: me, isPending } = useMe();
  const { has } = useFeatureAccess();
  const brand = useBrand();

  const items = franchiseNav(has);
  const active = activeFranchisePath(items, pathname);
  const accountActive = pathname === "/franchise/account";
  const name = me?.user.fullName ?? me?.user.email ?? "";

  // The badges poll their own endpoints; enabling them on the feature they
  // count for keeps a facility user's rail from 403-ing silently against a
  // door its keys cannot open.
  const redemptions = useRedemptionsBadge({
    enabled: has("franchise.payouts"),
  });
  const upi = useUpiChangesBadge({ enabled: has("franchise.payouts") });
  // The facility's desk: what is still `requested`. A rail badge is a backstop
  // and never toasts (`usePartRequestCounts`); enabled on `parts.handle` so a
  // role without it never calls a door its key cannot open.
  const parts = usePartRequestCounts({ enabled: has("parts.handle") });

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
        {/* The company's mark, not an icon: a franchisee admin works under
            their company's brand (§5.7), and `brand.mark` is the `companies.code`
            stamped once — never derived here. */}
        <BrandMark mark={brand.mark} label={brand.name} />
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            {isPending ? (
              <Skeleton className="h-3.5 w-24 bg-white/15" />
            ) : (
              <div className="truncate text-[13px] font-semibold text-white">
                {brand.name}
              </div>
            )}
            {/* The franchisee's own name — the second line, never the tile. */}
            <div className="truncate text-[11px] font-medium text-white/50">
              {me?.franchisee?.name ?? ""}
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
        aria-label="Franchise portal"
      >
        {isPending
          ? // Reserve the rows so the rail does not jump once `/auth/me` lands
            // and this franchisee's features are known.
            [0, 1, 2].map((i) => (
              <Skeleton key={i} className="mb-0.5 h-9.5 bg-white/10" />
            ))
          : items.map((item) => {
              const isActive = item.to === active;
              const Icon = item.icon;
              // A badge counts work waiting on THIS franchisee. Zero, a
              // non-integer state or an unheld feature draws nothing — a rail
              // that says "0" beside everything is noise, and the two count
              // endpoints can both legitimately be empty.
              const badge =
                (item.to === "/franchise/redemptions"
                  ? redemptions.data
                  : item.to === "/franchise/upi-changes"
                    ? upi.data
                    : item.to === "/franchise/parts"
                      ? parts.data?.requested
                      : undefined) ?? 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  aria-current={isActive ? "page" : undefined}
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
                  {badge > 0 && (
                    // Same chip the ops rail's badge draws where a count is
                    // wanted but must not shift the whole row.
                    <span
                      className={cn(
                        "grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold",
                        "bg-white text-brand-600"
                      )}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
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
        {/* The way to your own record. `/franchise/account` is ungated in
            FRANCHISE_UNGATED, so it is reachable whatever this franchisee's
            features. */}
        <NavLink
          to="/franchise/account"
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