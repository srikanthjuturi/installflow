import { Bell, Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LinkButton } from "./LinkButton";
import { ThemeToggle } from "./ThemeToggle";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useSession } from "@/store/session";
import type { Role } from "@/types";

const SCOPES: Role[] = ["NH", "RSH", "ASM"];

interface TopbarProps {
  title: string;
  subtitle: string;
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const { role, setRole, setSidebarOpen } = useSession();
  const { data: unread = 0 } = useUnreadNotificationCount();

  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center gap-3.5 border-b border-line bg-surface px-5.5">
      <Button
        variant="outline"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={() => setSidebarOpen(true)}
      >
        <Menu aria-hidden />
      </Button>

      <div className="min-w-0">
        <h1 className="truncate text-base leading-tight font-semibold">
          {title}
        </h1>
        <p className="truncate text-xs text-ink-3">{subtitle}</p>
      </div>

      <div className="flex-1" />

      <div className="hidden h-9.5 w-65 items-center gap-2 rounded-full border border-line bg-surface-2 px-3.5 text-ink-3 lg:flex">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          type="search"
          placeholder="Search tickets, technicians…"
          aria-label="Search"
          className="w-full border-none bg-transparent text-[13px] text-ink outline-none"
        />
      </div>

      {/* Presentation only — real scoping is a server-side guard. */}
      <div
        className="flex items-center gap-1 rounded-full border border-line bg-surface-2 p-0.5"
        role="group"
        aria-label="View scope"
      >
        {SCOPES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={role === r}
            onClick={() => setRole(r)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              role === r
                ? "bg-brand-500 text-white"
                : "text-ink-2 hover:text-ink"
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <ThemeToggle />

      {/* It navigates, so it is a link. The dot is decorative — the count is
          in the accessible name, never carried by colour alone. */}
      <LinkButton
        to="/notifications"
        variant="outline"
        size="icon"
        className="relative rounded-full"
        aria-label={
          unread > 0 ? `Notifications · ${unread} unread` : "Notifications"
        }
      >
        <Bell aria-hidden />
        {unread > 0 ? (
          <span className="absolute top-1.5 right-2 size-2 rounded-full border-[1.5px] border-surface-2 bg-brand-accent" />
        ) : null}
      </LinkButton>
    </header>
  );
}
