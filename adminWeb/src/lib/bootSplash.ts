/**
 * Dismissing the boot splash in index.html.
 *
 * The splash covers the gap between the browser painting index.html and this
 * bundle existing at all, so nothing inside the bundle can be what shows it —
 * it is already on screen by the time any of this runs. All that is left is
 * taking it away at the right moment.
 *
 * "The right moment" is after React has COMMITTED, not after `render()` was
 * called: with a concurrent root that call only schedules work, so anything
 * timed off it can uncover a container React has not filled yet — a flicker of
 * blank page in the one place the splash exists to prevent it. An effect is the
 * earliest thing guaranteed to run after a commit, so the call site is one.
 */

const FADE_MS = 220;

let dismissed = false;

export function dismissBootSplash(): void {
  // StrictMode runs effects twice in development, and a second call would
  // restart a fade that is already running.
  if (dismissed) return;
  dismissed = true;

  const boot = document.getElementById("boot");
  if (!boot) return;

  // Drives the CSS transition rather than carrying the duration in JS as well;
  // index.html owns how it looks, this owns when.
  boot.dataset.leaving = "true";

  const remove = () => boot.remove();
  // `transitionend` does not fire when the tab is hidden or motion is reduced
  // away, which would leave an invisible overlay swallowing every click. The
  // timer is the one that actually guarantees removal.
  boot.addEventListener("transitionend", remove, { once: true });
  window.setTimeout(remove, FADE_MS + 80);
}
