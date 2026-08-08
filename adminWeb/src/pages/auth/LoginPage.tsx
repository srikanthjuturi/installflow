import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { BrandPanel } from "@/components/auth/BrandPanel";
import { CredentialsStep } from "@/components/auth/CredentialsStep";
import { PageMeta } from "@/components/shared/PageMeta";
import { useLogin } from "@/hooks/useAuth";
import { useSession } from "@/store/session";

/**
 * Single-step sign-in against the live backend. The API is password-only (no
 * OTP — that is the technician mobile app's flow), so a successful credentials
 * submit is the session. A superadmin lands on the companies console; anyone
 * else lands on the ops dashboard. The password is never held in this
 * component — it is passed straight to the mutation and dropped.
 */
export default function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();

  return (
    <>
      <PageMeta title="Sign in" description="InstallFlow console sign-in." />
      <div className="grid min-h-svh md:grid-cols-[1.05fr_0.95fr]">
        <BrandPanel />

        <div className="flex items-center justify-center bg-surface px-8 py-10">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-90"
          >
            <CredentialsStep
              defaultEmail=""
              onSubmit={async (values) => {
                await login.mutateAsync({
                  email: values.email,
                  password: values.password,
                });
                // signInBackend has run; route by role.
                const superadmin = useSession.getState().superadmin;
                navigate(superadmin ? "/companies" : "/", { replace: true });
              }}
            />
          </motion.div>
        </div>
      </div>
    </>
  );
}
