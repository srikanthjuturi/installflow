/**
 * The platform console — the surface that belongs to no company.
 *
 * It was missing from the deck entirely, and it is the one place the
 * multi-tenancy claim can actually be SHOWN rather than asserted: a list of
 * companies, and the geography master all of them share. Act 3 of the overview
 * promises "multi-tenant, white-labelled, audited" over two screenshots that
 * demonstrate none of the three.
 *
 * `SuperadminShell` is a different shell from `AppShell` — its own rail, no
 * company switcher, no search — so these do not look like the screens above
 * them, which is the point.
 *
 * ⚠ Deliberately NOT captured: `/rules` (the platform's own settings) and
 * `/recharges`. Those carry the free-credit allowance, the price of a ticket
 * and the platform's UPI payee — commercial terms, on a page a customer is
 * being handed. They are reachable and they are fine internally; they are not
 * fine in a client deliverable.
 */

import { createInterceptor } from './lib/guard.mjs';
import { credentials, env } from './lib/env.mjs';

const SITE = env('DECK_CONSOLE_URL', 'http://localhost:5173');
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(SITE);

/** The same hygiene the ops console gets: light theme, no prompts, no worker. */
const HYGIENE = () => {
  try {
    localStorage.setItem('theme', 'light');
  } catch {
    /* a blocked storage is not a reason to abandon the shot */
  }
  try {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
    Notification.requestPermission = async () => 'denied';
  } catch {
    /* older surface, no prompt to suppress */
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = async () => new Promise(() => {});
  }
};

async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page
    .waitForFunction(
      () => !document.querySelector('.animate-pulse, [data-slot="skeleton"]'),
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.waitForTimeout(700);
}

const SCREENS = [
  ['super-companies', '/companies', 'Every company, kept apart', "One company's data is never reachable from another's"],
  ['super-geography', '/geography', 'One geography, shared by all', 'Region, state, district and pincode — India is the same for everybody'],
];

export async function captureSuperadmin({ browser, recorder }) {
  const interceptor = createInterceptor({
    label: 'console/superadmin',
    readOnly: true,
    mask: !IS_LOCAL,
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    permissions: [],
  });
  await context.addInitScript(HYGIENE);
  await interceptor.install(context);

  const page = await context.newPage();

  // Same sign-in form as everybody else — a superadmin is a user whose
  // `company_id` is None by design, not a separate door.
  const { email, password } = credentials('superadmin');
  await page.goto(`${SITE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30000 });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#email', { state: 'detached', timeout: 45000 });

  for (const [id, route, title, sub] of SCREENS) {
    await page.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await recorder.record({
      id,
      section: 'Platform console',
      title,
      sub,
      kind: 'console',
      target: page,
    });
  }

  interceptor.assertNoWrites();
  await context.close();
}
