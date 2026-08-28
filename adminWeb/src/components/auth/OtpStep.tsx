import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const OTP_LENGTH = 6;

/**
 * The 6-digit code step, shared by anything that has to prove possession of a
 * destination before continuing.
 *
 * Its copy is the prototype's and does not change; what varies is where the
 * code went (`destination`) and how long until another may be asked for
 * (`resendInSeconds`, which the API states — it is `OTP_RESEND_SECONDS`, not a
 * number this component may invent).
 */
export function OtpStep({
  destination,
  resendInSeconds,
  onBack,
  onVerify,
  onResend,
}: {
  /** Already masked or plain, whatever the caller judged safe to show. */
  destination: string;
  resendInSeconds: number;
  onBack: () => void;
  /** Receives the code to verify. Rejects if the call fails. */
  onVerify: (code: string) => Promise<void>;
  /** Asks for another code. Resolves with the new cooldown, in seconds. */
  onResend: () => Promise<number>;
}) {
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(resendInSeconds);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const complete = code.length === OTP_LENGTH;

  /**
   * Awaited so the button stays disabled for the whole round trip.
   *
   * The rejection is swallowed rather than rendered here: hard rule 9 — every
   * API failure goes to the toaster, and an inline red box would report the
   * same wrong code twice. The code is cleared so the next attempt starts from
   * an empty field rather than from six digits already known to be wrong.
   */
  const submit = async () => {
    setBusy(true);
    try {
      await onVerify(code);
    } catch {
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      setSecondsLeft(await onResend());
      setCode("");
    } catch {
      // Toasted. The countdown stays at zero so they can try again.
    } finally {
      setBusy(false);
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
        <b className="font-semibold text-ink">{destination}</b>.
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete && !busy) void submit();
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

        <Button
          type="submit"
          className="mt-6 h-11.5 w-full"
          disabled={!complete || busy}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? "Verifying…" : "Verify"}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-ink-3">
        Didn't get it?{" "}
        {secondsLeft > 0 ? (
          <span>
            Resend in {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, "0")}
          </span>
        ) : (
          <button
            type="button"
            className="font-medium text-brand-400 hover:text-brand-500 disabled:opacity-60"
            disabled={busy}
            onClick={() => void resend()}
          >
            Resend code
          </button>
        )}
      </p>
    </div>
  );
}
