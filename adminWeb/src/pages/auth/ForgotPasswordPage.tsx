import { useState } from "react";
import { useNavigate } from "react-router";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ForgotEmailStep } from "@/components/auth/ForgotEmailStep";
import { NewPasswordStep } from "@/components/auth/NewPasswordStep";
import { OtpStep } from "@/components/auth/OtpStep";
import { ResetSteps } from "@/components/auth/ResetSteps";
import type { ResetStep } from "@/components/auth/resetFlow";
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
  /** Both stated by the API on every send, never assumed here. */
  const [timing, setTiming] = useState({ resendIn: 30, expiresIn: 600 });
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [step, setStep] = useState<ResetStep>("email");

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

  /** Sends, and reports back the two waits the code screen counts down. */
  async function sendCode(to: string): Promise<[number, number]> {
    const result = await request.mutateAsync(to);
    if (!result.sent) {
      reportUndelivered();
      throw new Error("undelivered");
    }
    setTiming({
      resendIn: result.resendInSeconds,
      expiresIn: result.expiresInSeconds,
    });
    return [result.resendInSeconds, result.expiresInSeconds];
  }

  return (
    <>
      <PageMeta
        title="Reset password"
        description="Reset your Reliance GreenTech console password."
      />
      <AuthLayout>
        {/* Above every step and rendered once, so the three of them stay
            unaware of the sequence they are part of and there is one place
            deciding where it sits. */}
        <ResetSteps current={step} />

        <div className="mt-6">
          {step === "email" ? (
            <ForgotEmailStep
              defaultEmail={email}
              onSubmit={async (values) => {
                await sendCode(values.email);
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
              resendInSeconds={timing.resendIn}
              expiresInSeconds={timing.expiresIn}
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
                  description:
                    "You have been signed out on every other device.",
                });
                // `signInBackend` has run, so the store already knows which
                // surface this account belongs to. One path, not two — the same
                // call LoginPage makes.
                const { superadmin, portal } = useSession.getState();
                navigate(landingPath({ superadmin, portal }), {
                  replace: true,
                });
              }}
            />
          ) : null}
        </div>
      </AuthLayout>
    </>
  );
}
