import { useState } from "react";
import { useNavigate } from "react-router";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ForgotEmailStep } from "@/components/auth/ForgotEmailStep";
import { NewPasswordStep } from "@/components/auth/NewPasswordStep";
import { OtpStep } from "@/components/auth/OtpStep";
import { PageMeta } from "@/components/shared/PageMeta";
import { toast } from "@/components/ui/toast";
import {
  useConfirmPasswordReset,
  useRequestPasswordReset,
  useVerifyPasswordResetCode,
} from "@/hooks/useAuth";
import { landingPath, useSession } from "@/store/session";

/**
 * A forgotten console password, in three steps: the email, the code we send to
 * it, then the new password.
 *
 * The middle step exists on its own rather than being folded into the last one
 * so that "your code was right" lands the moment it is typed. Verifying only on
 * submit would mean somebody who mistyped a digit finds out after also choosing
 * and repeating a password.
 *
 * All the state is local. It is a multi-step form draft — client state by
 * definition — and none of it should survive a reload: `resetToken` is
 * bearer-grade for its fifteen minutes, so the session store (which persists to
 * localStorage) is the wrong home for it. A refresh mid-flow starts over, which
 * costs one email and is the correct trade.
 *
 * Signed-out only. The route sits under `RedirectIfSignedIn`, so somebody who
 * already has a session is sent to their landing page rather than offered a
 * reset — `/account/password` is their screen, and it knows their current
 * password is available.
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const request = useRequestPasswordReset();
  const verify = useVerifyPasswordResetCode();
  const confirm = useConfirmPasswordReset();

  const [email, setEmail] = useState("");
  const [resendInSeconds, setResendInSeconds] = useState(30);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [step, setStep] = useState<"email" | "code" | "password">("email");

  /**
   * A 200 with `sent: false` is not an error — the code exists and the throttle
   * slot is spent — but it is not progress either: no message is coming, so
   * advancing would put them on a code screen with nothing to type. Said here
   * rather than by the global handler, which only ever sees rejections.
   */
  function reportUndelivered() {
    toast.add({
      type: "error",
      priority: "high",
      title: "Couldn't send a code",
      description:
        "We could not email a code to that address. Try again in a moment, or ask your administrator.",
    });
  }

  async function sendCode(to: string): Promise<number> {
    const result = await request.mutateAsync(to);
    if (!result.sent) {
      reportUndelivered();
      throw new Error("undelivered");
    }
    return result.resendInSeconds;
  }

  return (
    <>
      <PageMeta
        title="Reset password"
        description="Reset your Reliance GreenTech console password."
      />
      <AuthLayout>
        {step === "email" ? (
          <ForgotEmailStep
            defaultEmail={email}
            onSubmit={async (values) => {
              setResendInSeconds(await sendCode(values.email));
              setEmail(values.email);
              setStep("code");
            }}
          />
        ) : null}

        {step === "code" ? (
          <OtpStep
            // The address they just typed, unmasked: they are looking at the
            // screen they typed it on, so hiding it would only make a typo
            // harder to spot — and it is already in the field behind Back.
            destination={email}
            resendInSeconds={resendInSeconds}
            onBack={() => setStep("email")}
            onVerify={async (code) => {
              const ticket = await verify.mutateAsync({ email, code });
              setResetToken(ticket.resetToken);
              setStep("password");
            }}
            onResend={() => sendCode(email)}
          />
        ) : null}

        {step === "password" && resetToken ? (
          <NewPasswordStep
            email={email}
            onSubmit={async (values) => {
              await confirm.mutateAsync({
                resetToken,
                newPassword: values.newPassword,
              });
              toast.add({
                title: "Password changed",
                description: "You have been signed out on every other device.",
              });
              // `signInBackend` has run, so the store already knows which
              // surface this account belongs to. One path, not two — the same
              // call LoginPage makes.
              const { superadmin, portal } = useSession.getState();
              navigate(landingPath({ superadmin, portal }), { replace: true });
            }}
          />
        ) : null}
      </AuthLayout>
    </>
  );
}
