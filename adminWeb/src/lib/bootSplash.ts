/**
 * Dismissing the boot splash in index.html.
 *
 * The splash covers the gap between the browser painting index.html and this
 * bundle existing at all, so nothing inside the bundle can be what shows it —
 * it is already on screen by the time any of this runs. All that is left is
 * taking it away at the right moment.
 *
 * "The right moment" is when the app has actually PUT SOMETHING ON SCREEN, which
 * is later than it sounds. React having mounted is not enough: entering at `/`
 * redirects to the landing route, and a redirect commits an empty tree before
 * the target's lazy chunk arrives. React Router runs navigations inside a
 * transition, and a transition deliberately keeps the previous UI rather than
 * dropping to a Suspense fallback — so with "previous UI" being that empty
 * commit, nothing renders at all until the chunk lands. Measured at 1.6s of
 * blank page on a throttled load, with the route skeleton never appearing.
 *
 * That gap predates this splash; it was simply invisible while the whole boot
 * was blank. Dismissing on mount would have made it worse, not better — a
 * splash that appears, vanishes, and leaves a blank page reads as a crash.
 *
 * So the splash waits for `#root` to hold something. The ceiling matters as
 * much as the wait: if the app never renders, hiding that behind a tidy splash
 * forever is the worst possible outcome, so it gives up and reveals whatever is
 * underneath — an error boundary, an empty state, or the truth.
 */

const FADE_MS = 220;
const MAX_WAIT_MS = 10_000;

let dismissed = false;

export function dismissBootSplash(): void {
  // StrictMode runs effects twice in development, and a second call would
  // restart a fade that is already running.
  if (dismissed) return;
  dismissed = true;

  const boot = document.getElementById("boot");
  if (!boot) return;

  const root = document.getElementById("root");
  const startedAt = performance.now();

  const whenPainted = () => {
    const hasContent = (root?.childElementCount ?? 0) > 0;
    if (hasContent || performance.now() - startedAt > MAX_WAIT_MS) {
      fadeOut(boot);
      return;
    }
    requestAnimationFrame(whenPainted);
  };
  whenPainted();
}

function fadeOut(boot: HTMLElement): void {

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
