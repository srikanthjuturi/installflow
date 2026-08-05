import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 24;

export function OtpStep({
  onBack,
  onVerify,
}: {
  onBack: () => void;
  /** Receives the code to verify. Rejects if the call fails. */
  onVerify: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [verifying, setVerifying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const complete = code.length === OTP_LENGTH;

  /** Awaited so the button stays disabled for the whole round trip. */
  const submit = async () => {
    setFailure(null);
    setVerifying(true);
    try {
      await onVerify(code);
    } catch (err) {
      setFailure(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>

      <h1 className="mt-4.5 text-[22px] font-semibold">Verify it's you</h1>
      <p className="mt-1.5 text-[13px] text-ink-2">
        Enter the 6-digit code sent to{" "}
        <b className="font-semibold text-ink">+91 98••• ••210</b>.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete && !verifying) void submit();
        }}
      >
        <InputOTP
          maxLength={OTP_LENGTH}
          value={code}
          onChange={setCode}
          autoFocus
          aria-label="One-time code"
          containerClassName="justify-between"
        >
          <InputOTPGroup className="gap-2.5">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className="size-13 font-mono text-xl"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>

        {/* Whatever the envelope reported, in the same shape every other form
            in the console uses for a failed request. */}
        {failure ? (
          <p
            role="alert"
            className="mt-4 rounded-md bg-danger-bg px-3 py-2.5 text-xs text-danger"
          >
            {failure}
          </p>
        ) : null}

        <Button
          type="submit"
          className="mt-6 h-11.5 w-full"
          disabled={!complete || verifying}
        >
          Verify &amp; sign in
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-ink-3">
        Didn't get it?{" "}
        {secondsLeft > 0 ? (
          <span>Resend in 0:{String(secondsLeft).padStart(2, "0")}</span>
        ) : (
          <button
            type="button"
            className="font-medium text-brand-400 hover:text-brand-500"
            onClick={() => setSecondsLeft(RESEND_SECONDS)}
          >
            Resend code
          </button>
        )}
      </p>
    </div>
  );
}
