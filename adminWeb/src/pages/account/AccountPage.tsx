import { useNavigate } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { AccountCard } from "@/components/account/AccountCard";
import { useAuthUser, useSignOut } from "@/hooks/useAuth";

/** The signed-in user's own record, and the only way out of the console. */
export default function AccountPage() {
  const user = useAuthUser();
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <>
      <PageMeta
        title="Account"
        description="Your InstallFlow profile, scope and session."
      />
      {/* The route guard only lets a signed-in session through, so `user` is
          present here — the check is what makes that a type, not a hope. */}
      {user ? (
        <AccountCard
          user={user}
          onSignOut={() => {
            signOut();
            navigate("/login", { replace: true });
          }}
        />
      ) : null}
    </>
  );
}
