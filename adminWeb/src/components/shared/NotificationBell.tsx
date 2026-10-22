import { Bell } from "lucide-react";
import { useLocation } from "react-router";
import { SHELL_PATHS, surfaceOf } from "@/lib/surface";
import { LinkButton } from "./LinkButton";
import { useNavOrigin } from "@/hooks/useNavOrigin";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useSession } from "@/store/session";

/**
 * The unread bell, for whichever shell is rendering it.
 *
 * Lifted out of `Topbar` so the vendor portal can have one too. `VendorShell`
 * renders its own header rather than `Topbar` — it deliberately has no company
 * switcher and no search box — and copying twenty lines into it would be the
 * copy that drifts the first time the badge changes.
 *
 * Reads the surface flags from the session itself rather than taking one as a
 * prop, unlike `AddressFields` — `Topbar` was already reading them here, and
 * the route it links to is every shell's business, not a caller's.
 *
 * The audience is settled in SQL — the API scopes a vendor's feed to
 * notifications carrying their own `vendor_id` — so this component needs to
 * know nothing about who is looking.
 */
export function NotificationBell() {
  const { data: unread = 0 } = useUnreadNotificationCount();
  // The surfaces have separate route trees; the bell is the same component in
  // all of them, and each shell's bell, account page and password form come
  // off one table (`SHELL_PATHS`) rather than a ternary per consumer — a
  // sixth surface is then a new row, not a missed `else`.
  const superadmin = useSession((s) => s.superadmin);
  const portal = useSession((s) => s.portal);
  const franchise = useSession((s) => s.franchise);

  const notificationsPath =
    SHELL_PATHS[surfaceOf({ superadmin, portal, franchise })].notifications;
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
    /* It navigates, so it is a link. The dot is decorative — the count is in
       the accessible name, never carried by colour alone. */
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
  );
}
