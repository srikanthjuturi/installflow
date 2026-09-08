/**
 * The approved technician-app prototype — `mobileapp/appdesign/Technician Field
 * App.html`, 18 screens, copy and colours signed off.
 *
 * Used for the screens the running app cannot give us safely: the four proof
 * cameras (a headless browser has no camera, and a synthetic test pattern on a
 * client slide looks like a bug), and the AI verification screens, which are
 * built but deliberately unwired in v1.
 *
 * Everything here is inert — a static file with no network and no database — so
 * none of the production rules apply.
 */

import path from 'node:path';
import { serveDir } from './lib/serve.mjs';
import { REPO_ROOT } from './lib/shot.mjs';

const PROTOTYPE = 'Technician%20Field%20App.html';

/** The phone frame, not the page: the slide wants the device, not the index beside it. */
const PHONE = '#dc-root aside + div';

/**
 * The sidebar rows, by their exact label. Clicking the label bubbles to the
 * row's React onClick — which is the only way to move between screens, since the
 * prototype keeps its screen in component state and never touches the URL.
 */
async function openScreen(page, label) {
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(280);
}

async function clickButton(page, label) {
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(280);
}

/**
 * The phone frame has a 44px corner radius, so an element screenshot of it
 * captures whatever sits BEHIND those four corners. The design tool's canvas is
 * a warm off-white (#f0eee6), which reads as a grey halo boxing the device in
 * once the shot is placed on the deck's cooler page colour. Repaint the ground —
 * and only the ground — so the corners disappear into the slide.
 *
 * Keep this value in step with PAGE in build/theme.py.
 */
async function paintGround(page) {
  await page.addStyleTag({
    content: `
      html, body,
      #dc-root, #dc-root > .sc-host, #dc-root > .sc-host > div {
        background: #eef1f3 !important;
      }
    `,
  });
}

/** The 18 sidebar screens, in the order the prototype lists them. */
const SCREENS = [
  ['proto-register-invite', 'Register — invite link', 'Invited by a manager', 'A phone number is all the manager supplies'],
  ['proto-register-categories', 'Register — categories', 'The technician self-registers', 'Skills and coverage, chosen by them'],
  ['proto-login', 'Login / OTP', 'The phone is the credential', 'No password, and nothing to forget'],
  ['proto-home', "Home — today's jobs", "Today's work, at a glance", ''],
  ['proto-availability', 'Availability & bandwidth', 'The technician sets their own cap', 'Jobs per day, counted by slot date'],
  ['proto-pool', 'Open job pool', 'Jobs they are eligible for', 'Matched on skill, pincode and remaining capacity'],
  ['proto-offer', 'Job offer (masked)', 'Details stay masked until accepted', 'The slot is fixed — they accept a time, never propose one'],
  ['proto-myjobs', 'My jobs', 'Upcoming, in progress, completed', ''],
  ['proto-detail', 'Job detail (unlocked)', 'Accepted — the customer is revealed', ''],
  ['proto-cancel', 'Cancel + penalty', 'Cancelling costs money', 'Banded by lateness, and the band is shown before they commit'],
  ['proto-proof-barcode', 'Proof: barcode', 'Proof one — the barcode', ''],
  ['proto-proof-serial', 'Proof: serial', 'Proof two — the serial', 'Checked against the serial the vendor supplied at intake'],
  ['proto-proof-photos', 'Proof: photos', 'Proof three — the installation', ''],
  ['proto-proof-live', 'Proof: geo live', 'Proof four — a geo-tagged live shot', 'Gallery uploads are never accepted'],
  ['proto-review', 'Review & submit', 'Four artifacts, one submission', ''],
  ['proto-ai-result', 'AI result / retake', 'Verified against the paperwork', ''],
  ['proto-earnings', 'Earnings ledger', 'Every rupee, itemised', 'Payouts, bonuses and penalties in one list'],
  ['proto-profile', 'Profile & settings', '', ''],
];

export async function capturePrototype({ browser, recorder }) {
  const server = await serveDir(path.join(REPO_ROOT, 'mobileapp', 'appdesign'));

  try {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();

    await page.goto(`${server.origin}/${PROTOTYPE}`, { waitUntil: 'load' });
    await page.waitForSelector('#dc-root .sc-host', { timeout: 60000 });
    await page.waitForSelector(PHONE, { timeout: 60000 });

    await paintGround(page);
    // The bundler swaps the whole document and then mounts React; one settled
    // frame after the phone appears is the difference between a screenshot of
    // the app and a screenshot of a half-painted one.
    await page.waitForTimeout(1200);

    const phone = page.locator(PHONE);

    for (const [id, label, title, sub] of SCREENS) {
      await openScreen(page, label);
      await recorder.record({
        id,
        section: 'Technician app — design reference',
        title: title || label,
        sub,
        kind: 'phone',
        target: phone,
      });
    }

    // ── Sub-states with no sidebar row of their own ────────────────────────

    // The OTP step. `Login / OTP` opens on the phone-number step.
    await openScreen(page, 'Login / OTP');
    await clickButton(page, 'Send OTP');
    await recorder.record({
      id: 'proto-login-otp',
      section: 'Technician app — design reference',
      title: 'One code, and they are in',
      sub: '',
      kind: 'phone',
      target: phone,
    });

    // The accept sheet — "Commit to this slot?". Reached from the masked offer.
    await openScreen(page, 'Job offer (masked)');
    await clickButton(page, 'Accept job');
    await recorder.record({
      id: 'proto-accept-sheet',
      section: 'Technician app — design reference',
      title: 'First accept wins',
      sub: 'Losing the race is a normal outcome, not an error',
      kind: 'phone',
      target: phone,
    });

    // Dismiss it. The sheet is a modal overlay — left open it sits on top of the
    // sidebar and swallows every subsequent click.
    await clickButton(page, 'Not now');

    // Verifying. `submitProof()` sets a 2.4-second timer to the result screen,
    // so neutralise long timers before clicking rather than racing them.
    await openScreen(page, 'Review & submit');
    await page.evaluate(() => {
      const real = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...rest) => (ms >= 1000 ? 0 : real(fn, ms, ...rest));
    });
    await clickButton(page, 'Submit for AI verification');
    await recorder.record({
      id: 'proto-verifying',
      section: 'Technician app — design reference',
      title: 'Checked before they leave site',
      sub: '',
      kind: 'phone',
      target: phone,
    });

    // Restore the real timer by reloading — the AI outcome chips below depend on
    // ordinary component behaviour. A reload drops the injected stylesheet, so
    // put the ground colour back before shooting anything else.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(PHONE, { timeout: 60000 });
    await paintGround(page);
    await page.waitForTimeout(1000);

    // The three AI outcomes, via the "Preview AI outcome" chip row on screen 14.
    await openScreen(page, 'AI result / retake');
    for (const [id, chip, title, sub] of [
      ['proto-ai-mismatch', 'Mismatch', 'Mismatch goes to a human', 'The area manager reviews it, not the algorithm'],
      ['proto-ai-unreadable', 'Unreadable', 'Unreadable means retake now', 'On site, before the technician leaves'],
    ]) {
      await clickButton(page, chip);
      await recorder.record({
        id,
        section: 'Technician app — design reference',
        title,
        sub,
        kind: 'phone',
        target: phone,
      });
    }

    // Closure — from the match outcome.
    await clickButton(page, 'Match');
    await clickButton(page, 'Send feedback link to customer');
    await recorder.record({
      id: 'proto-closure',
      section: 'Technician app — design reference',
      title: 'The customer is asked to close it',
      sub: 'Only they can — the technician cannot mark their own work done',
      kind: 'phone',
      target: phone,
    });

    await context.close();
  } finally {
    await server.close();
  }
}
