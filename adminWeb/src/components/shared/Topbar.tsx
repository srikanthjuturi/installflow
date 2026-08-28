import { Bell, Menu, Search } from "lucide-react";
import { useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { CompanySwitcher } from "./CompanySwitcher";
import { LinkButton } from "./LinkButton";
import { ThemeToggle } from "./ThemeToggle";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useSession } from "@/store/session";

interface TopbarProps {
  title: string;
  subtitle: string;
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const setSidebarOpen = useSession((s) => s.setSidebarOpen);
  const { data: unread = 0 } = useUnreadNotificationCount();
  // The two surfaces have separate route trees; the bell is the same
  // component in both.
  const portal = useSession((s) => s.portal);

  const notificationsPath = portal ? "/portal/notifications" : "/notifications";
  // The bell is on every screen, so the feed has no parent to go back to and
  // has to be TOLD where it was opened from — filters and page included, which
  // is why this carries the query string. The label is the flat word: the feed
  // is reached from everywhere, and one that named the screen behind it would
  // read differently on every visit. Not passed at all from the feed itself,
  // where "Back" pointing at the page you are on is not a way out.
  const { pathname } = useLocation();
  const origin = useNavOrigin(
    pathname === notificationsPath ? undefined : "Back"
  );

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

      {/* The company this session is scoped to; a dropdown when there's more
          than one. Replaces the old presentation-only role tabs. */}
      <CompanySwitcher />

      <ThemeToggle />

      {/* It navigates, so it is a link. The dot is decorative — the count is
          in the accessible name, never carried by colour alone. */}
      <LinkButton
        to={notificationsPath}
        state={origin}
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
