import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 24;

export function OtpStep({
  onBack,
  onVerify,
}: {
  onBack: () => void;
  onVerify: () => void;
}) {
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const complete = code.length === OTP_LENGTH;

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>

      <h1 className="mt-4.5 text-[22px] font-semibold">Verify it's you</h1>
      <p className="text-ink-2 mt-1.5 text-[13px]">
        Enter the 6-digit code sent to{" "}
        <b className="text-ink font-semibold">+91 98••• ••210</b>.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete) onVerify();
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
              <InputOTPSlot key={i} index={i} className="size-13 font-mono text-xl" />
            ))}
          </InputOTPGroup>
        </InputOTP>

        <Button type="submit" className="mt-6 h-11.5 w-full" disabled={!complete}>
          Verify &amp; sign in
        </Button>
      </form>

      <p className="text-ink-3 mt-4 text-center text-xs">
        Didn't get it?{" "}
        {secondsLeft > 0 ? (
          <span>Resend in 0:{String(secondsLeft).padStart(2, "0")}</span>
        ) : (
          <button
            type="button"
            className="text-brand-400 hover:text-brand-500 font-medium"
            onClick={() => setSecondsLeft(RESEND_SECONDS)}
          >
            Resend code
          </button>
        )}
      </p>
    </div>
  );
}
