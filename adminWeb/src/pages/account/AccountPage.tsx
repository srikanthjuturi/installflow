import { PageMeta } from "@/components/shared/PageMeta";
import { SHELL_PATHS, surfaceOf } from "@/lib/surface";
import { AccountCard } from "@/components/account/AccountCard";
import { useCurrentUser, useSignOut } from "@/hooks/useAuth";
import { useSession } from "@/store/session";

/** The signed-in user's own record, and the only way out of the console. */
export default function AccountPage() {
  const user = useCurrentUser();
  const memberships = useSession((s) => s.memberships);
  const activeCompanyId = useSession((s) => s.activeCompanyId);
  const portal = useSession((s) => s.portal);
  const franchise = useSession((s) => s.franchise);
  const superadmin = useSession((s) => s.superadmin);
  const signOut = useSignOut();

  return (
    <>
      <PageMeta
        title="Account"
        description="Your profile, companies and session."
      />
      {/* The route guard only lets a signed-in session through, so `user` is
          present here — the check is what makes that a type, not a hope. */}
      {user ? (
        <AccountCard
          user={user}
          memberships={memberships}
          activeCompanyId={activeCompanyId}
          changePasswordTo={
            SHELL_PATHS[surfaceOf({ superadmin, portal, franchise })].password
          }
          onSignOut={async () => {
            await signOut();
            window.location.assign("/login");
          }}
        />
      ) : null}
    </>
  );
}
