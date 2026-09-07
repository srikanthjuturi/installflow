import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanySwitcher } from "./CompanySwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { useSession } from "@/store/session";

interface TopbarProps {
  title: string;
  subtitle: string;
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const setSidebarOpen = useSession((s) => s.setSidebarOpen);

  return (
    // Already `sticky`, so it is a positioned ancestor — which is what the
    // small-screen search bar anchors to when it covers this row rather than
    // trying to fit inside it. No `relative` needed, and adding one would lose
    // to `sticky` anyway.
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

      {/* Yields to the search bar rather than squeezing it — a long page title
          and a usable box cannot both have the room on a narrow window. */}
      <div className="min-w-0 shrink">
        <h1 className="truncate text-base leading-tight font-semibold">
          {title}
        </h1>
        <p className="truncate text-xs text-ink-3">{subtitle}</p>
      </div>

      {/* No spacer: the search bar is the flex grower from `md` up, and below
          that it is a button, so this row still ends hard against the right. */}
      <div className="flex flex-1 justify-end md:justify-center">
        <GlobalSearch />
      </div>

      {/* The company this session is scoped to; a dropdown when there's more
          than one. Replaces the old presentation-only role tabs. */}
      <CompanySwitcher />

      <ThemeToggle />

      <NotificationBell />
    </header>
  );
}
