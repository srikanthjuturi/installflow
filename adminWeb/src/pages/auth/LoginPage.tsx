import { useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { BrandPanel } from "@/components/auth/BrandPanel";
import { CredentialsStep } from "@/components/auth/CredentialsStep";
import { OtpStep } from "@/components/auth/OtpStep";
import { PageMeta } from "@/components/shared/PageMeta";
import { useLogin, useVerifyOtp } from "@/hooks/useAuth";

type Step = "credentials" | "otp";

/**
 * Two-step sign-in. Ops staff have a password; the OTP is a second factor.
 * (The technician app is OTP-only — different actor, different rules.)
 *
 * Only the address survives between the steps. The password is never held
 * here, and the payload the credentials step returns is unverified — the
 * session is written from what step two answers with, by `useVerifyOtp`.
 */
export default function LoginPage() {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("ravi.sharma@installflow.in");
  const login = useLogin();
  const verify = useVerifyOtp();
  const navigate = useNavigate();

  return (
    <>
      <PageMeta
        title="Sign in"
        description="InstallFlow ops console sign-in."
      />
      <div className="grid min-h-svh md:grid-cols-[1.05fr_0.95fr]">
        <BrandPanel />

        <div className="flex items-center justify-center bg-surface px-8 py-10">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-90"
          >
            {step === "credentials" ? (
              <CredentialsStep
                defaultEmail={email}
                onSubmit={async (values) => {
                  await login.mutateAsync({
                    email: values.email,
                    password: values.password,
                  });
                  setEmail(values.email);
                  setStep("otp");
                }}
              />
            ) : (
              <OtpStep
                onBack={() => setStep("credentials")}
                onVerify={async (code) => {
                  await verify.mutateAsync(code);
                  navigate("/", { replace: true });
                }}
              />
            )}
          </motion.div>
        </div>
      </div>
    </>
  );
}
