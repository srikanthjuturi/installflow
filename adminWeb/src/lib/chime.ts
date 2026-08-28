/**
 * The sound a new notification makes while the console is open.
 *
 * Synthesised rather than shipped as a file, and that is not cleverness for its
 * own sake. An asset would be one more request on a page that may be offline,
 * one more thing for a cache to serve stale, and a binary in a repository whose
 * review process is reading diffs. Two sine waves and an envelope are a dozen
 * lines that always work.
 *
 * ## Deliberately quiet and short
 *
 * This plays on a machine somebody is already looking at — the toast is what
 * actually tells them, and the sound only turns their head. A chime that
 * announces itself is one people mute within a day, and a muted console hears
 * nothing when it matters.
 *
 * ## Browsers do not let a page make noise unasked
 *
 * An `AudioContext` created before the user has interacted with the page starts
 * `suspended`, and Chrome logs a warning for creating one at all. So the
 * context is built lazily on the first real interaction — `prime()` — and if
 * that never happened, `chime()` simply does nothing rather than throwing into
 * a notification handler.
 */

let context: AudioContext | null = null;
let primed = false;

/** The gain the two notes peak at. Low on purpose — see the note above. */
const VOLUME = 0.07;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    typeof window !== "undefined"
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    // Audio blocked outright, or no output device. Never fatal.
    return null;
  }
}

/**
 * Get the audio system ready, on the first thing the user does.
 *
 * Called once from the app shell. Without it the FIRST notification of a
 * session would be silent — the context would still be suspended at the moment
 * it mattered, and resuming takes a gesture that has already passed.
 */
export function primeChime(): () => void {
  if (primed || typeof window === "undefined") return () => {};

  const start = () => {
    primed = true;
    const ctx = audioContext();
    // `resume` on an already-running context is a no-op that still returns a
    // promise, so this is safe either way.
    void ctx?.resume().catch(() => {});
    stop();
  };

  const stop = () => {
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
  };

  // `once` is not enough: either event may fire first, and both must unbind.
  window.addEventListener("pointerdown", start, { once: true });
  window.addEventListener("keydown", start, { once: true });
  return stop;
}

/**
 * Two notes, a fifth apart, over about a third of a second.
 *
 * Rising rather than falling: a descending pair reads as something finishing or
 * failing, and every one of these events is somebody being asked to look.
 */
export function chime(): void {
  const ctx = audioContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") {
      // Worth one attempt — a context can be suspended by a tab going to the
      // background and resume the moment it returns.
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    // A5 then E6. Concert pitch, so it does not sit on top of whatever else
    // the machine is playing.
    for (const [frequency, at] of [
      [880, 0],
      [1318.51, 0.09],
    ] as const) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      // An envelope, not a switch: a bare start/stop on a sine wave clicks at
      // both ends, and the click is louder than the note.
      const begin = now + at;
      gain.gain.setValueAtTime(0, begin);
      gain.gain.linearRampToValueAtTime(VOLUME, begin + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, begin + 0.22);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(begin);
      oscillator.stop(begin + 0.24);
    }
  } catch {
    // A sound is the least important thing on this screen. It must never be
    // the reason a notification fails to arrive.
  }
}
