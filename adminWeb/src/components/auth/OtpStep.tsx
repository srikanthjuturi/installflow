import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const OTP_LENGTH = 6;

/** `0:07`, `9:41` — a wait somebody reads off a screen, not a duration. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** One ticking second, stopping at zero. Shared by the two counters below. */
function useCountdown(from: number): [number, (next: number) => void] {
  const [left, setLeft] = useState(from);
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [left]);
  return [left, setLeft];
}

/**
 * The 6-digit code step, for anything that has to prove possession of a
 * destination before continuing.
 *
 * Its copy is the prototype's. What varies is where the code went
 * (`destination`), how long until another may be asked for
 * (`resendInSeconds`), and how long this one lives (`expiresInSeconds`) — all
 * three stated by the API, never invented here.
 */
export function OtpStep({
  destination,
  resendInSeconds,
  expiresInSeconds,
  onBack,
  onVerify,
  onResend,
}: {
  /** Already masked or plain, whatever the caller judged safe to show. */
  destination: string;
  resendInSeconds: number;
  expiresInSeconds: number;
  onBack: () => void;
  /** Receives the code to verify. Rejects if the call fails. */
  onVerify: (code: string) => Promise<void>;
  /** Asks for another code. Resolves with `[resendIn, expiresIn]`, seconds. */
  onResend: () => Promise<[number, number]>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useCountdown(resendInSeconds);
  const [expiresIn, setExpiresIn] = useCountdown(expiresInSeconds);

  const expired = expiresIn <= 0;
  const complete = code.length === OTP_LENGTH;

  /**
   * Awaited so the button stays disabled for the whole round trip.
   *
   * The rejection is swallowed rather than rendered here: hard rule 9 — every
   * API failure goes to the toaster, and an inline red box would report the
   * same wrong code twice. The code is cleared so the next attempt starts from
   * an empty field rather than from six digits already known to be wrong.
   */
  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      try {
        await onVerify(value);
      } catch {
        setCode("");
      } finally {
        setBusy(false);
      }
    },
    [onVerify]
  );

  /**
   * Submit the moment the sixth digit lands — typed or pasted.
   *
   * The button stays, because a code that comes back wrong leaves six digits
   * in the field that a person may want to correct rather than retype, and
   * because a form with no submit control is not a form. But nobody should
   * have to reach for it in the ordinary case: the last digit IS the intent.
   *
   * Guarded on `submitted` so a re-render cannot fire the same code twice, and
   * reset whenever the field is cleared.
   */
  const submitted = useRef<string | null>(null);
  useEffect(() => {
    if (code.length < OTP_LENGTH) {
      submitted.current = null;
      return;
    }
    if (busy || expired || submitted.current === code) return;
    submitted.current = code;
    void submit(code);
  }, [code, busy, expired, submit]);

  const resend = async () => {
    setBusy(true);
    try {
      const [nextResend, nextExpiry] = await onResend();
      setResendIn(nextResend);
      setExpiresIn(nextExpiry);
      setCode("");
    } catch {
      // Toasted. The counters stay put so they can try again.
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
      {/* The address on its own line rather than inline: it is the one thing on
          this screen worth checking for a typo, and a long one wrapped
          mid-sentence is exactly where a typo hides. */}
      <p className="mt-1.5 text-[13px] text-ink-2">
        Enter the 6-digit code sent to
      </p>
      <p
        className="truncate text-[13px] font-semibold text-ink"
        title={destination}
      >
        {destination}
      </p>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete && !busy && !expired) void submit(code);
        }}
      >
        <InputOTP
          maxLength={OTP_LENGTH}
          value={code}
          onChange={setCode}
          disabled={busy || expired}
          autoFocus
          aria-label="One-time code"
          containerClassName="w-full"
        >
          {/* Six separate cells, so each carries its own border and radius —
              the primitive's defaults draw one connected strip (`border-y
              border-r`, ends rounded), which a gap turns into cells missing
              their left edge.

              `flex-1` rather than a fixed width so the row of cells ends flush
              with the button and the heading above it. Sized, the block sat a
              few pixels inside both and the column read as two edges. */}
          <InputOTPGroup className="w-full gap-2">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className="h-13 min-w-0 flex-1 rounded-lg border border-line font-mono text-xl font-medium text-ink first:rounded-l-lg last:rounded-r-lg"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>

        <Button
          type="submit"
          className="mt-6 h-11.5 w-full"
          disabled={!complete || busy || expired}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? "Verifying…" : "Verify"}
        </Button>
      </form>

      {/* One counter, not two. The code's ten-minute life stays silent until it
          runs out, because a second ticking number would only add urgency to a
          screen nobody is enjoying — but an expired code must not be typed
          into a field that will spend an attempt refusing it. */}
      <p className="mt-4 text-center text-xs text-ink-3" aria-live="polite">
        {expired ? (
          <>
            That code has expired.{" "}
            <button
              type="button"
              className="font-medium text-brand-400 hover:text-brand-500 disabled:opacity-60"
              disabled={busy}
              onClick={() => void resend()}
            >
              Send a new one
            </button>
          </>
        ) : (
          <>
            Didn't get it?{" "}
            {resendIn > 0 ? (
              <span>Resend in {clock(resendIn)}</span>
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
          </>
        )}
      </p>
    </div>
  );
}
