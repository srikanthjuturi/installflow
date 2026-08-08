import { Suspense } from "react";
import { Outlet } from "react-router";
import { Building2, LogOut } from "lucide-react";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { Button } from "@/components/ui/button";
import { useCurrentUser, useSignOut } from "@/hooks/useAuth";

/**
 * The superadmin surface — a single, focused console for managing companies.
 * Deliberately not the ops `AppShell`: a superadmin has no tickets, technicians
 * or ledger, so it gets a minimal top bar (identity + sign out) over a fluid
 * work area, and nothing else.
 */
export function SuperadminShell() {
  const user = useCurrentUser();
  const signOut = useSignOut();

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-40 flex h-15 items-center justify-between border-b border-line bg-surface px-4 md:px-5.5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-md bg-brand-500 text-surface">
            <Building2 className="size-4.5" aria-hidden />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-ink">Videocon Platform</p>
            <p className="text-[11px] font-medium text-ink-3">
              Super Admin console
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <span className="hidden text-xs text-ink-2 sm:inline">
              {user.email}
            </span>
          ) : null}
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
        </div>
      </header>

      <main className="p-4 md:p-5.5">
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
