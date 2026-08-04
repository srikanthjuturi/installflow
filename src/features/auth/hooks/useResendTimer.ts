import { useCallback, useEffect, useRef, useState } from 'react';

/** Counts down to zero, then allows a resend. Prototype starts at 24s. */
export function useResendTimer(seconds = 24) {
  const [remaining, setRemaining] = useState(seconds);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  const restart = useCallback(() => {
    clear();
    setRemaining(seconds);
    timer.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clear();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }, [seconds]);

  useEffect(() => {
    restart();
    return clear;
  }, [restart]);

  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, '0');

  return { remaining, label: `${mm}:${ss}`, canResend: remaining === 0, restart };
}
