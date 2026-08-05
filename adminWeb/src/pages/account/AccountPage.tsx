import { useNavigate } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { AccountCard } from "@/components/account/AccountCard";
import { useSession } from "@/store/session";

/** The signed-in user's own record, and the only way out of the console. */
export default function AccountPage() {
  const { name, email, role, signOut } = useSession();
  const navigate = useNavigate();

  return (
    <>
      <PageMeta
        title="Account"
        description="Your InstallFlow profile, scope and session."
      />
      <AccountCard
        name={name}
        email={email}
        role={role}
        onSignOut={() => {
          signOut();
          navigate("/login", { replace: true });
        }}
      />
    </>
  );
}
