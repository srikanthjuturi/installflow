/**
 * The ops console and the vendor portal, captured from the LIVE site at
 * `reliancegreentech.netlify.app`.
 *
 * That site already points at the deployed Azure API, which reads
 * `RelianceProdDB` — so these are production screens with production volumes,
 * and no local config is touched to get them. `adminWeb/.env.local` stays
 * exactly where it is.
 *
 * Every context here carries the interceptor from `lib/guard.mjs`: customer PII
 * is pseudonymised in the response body, and any write the shot list did not
 * mean to make is aborted before it reaches production.
 */

import { createInterceptor } from './lib/guard.mjs';
import { credentials, env } from './lib/env.mjs';

const SITE = env('DECK_CONSOLE_URL', 'http://localhost:5173');

/**
 * A local console reads the local API, which reads the DEVELOPMENT database and
 * the tenant `seed/seed_dev.mjs` built there. Every customer on those screens is
 * invented, so masking is off: rewriting invented names into other invented
 * names would churn the deck between runs for no gain.
 *
 * Point `DECK_CONSOLE_URL` at the deployed site and masking comes back on by
 * itself, because that console reads production.
 */
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(SITE);

/**
 * Applied before any of the app's own code runs.
 *
 * The clock is deliberately NOT frozen. Relative times ("in 2h") would be more
 * repeatable if it were, but the session's access token is a JWT the client
 * checks against the wall clock, and a deck is not worth breaking sign-in for.
 */
const HYGIENE = () => {
  try {
    // The console persists a theme choice; "system" would follow the headless
    // browser's preference and could produce a dark slide in a light deck.
    localStorage.setItem('theme', 'light');
  } catch {
    /* a blocked storage is not a reason to abandon the shot */
  }

  // Web push asks for a permission prompt on first sign-in. Deny it up front —
  // a native Chrome bubble in the corner of a client slide is not a feature.
  try {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
    Notification.requestPermission = async () => 'denied';
  } catch {
    /* older surface, no prompt to suppress */
  }

  // public/sw.js registers a service worker that can serve a stale shell and
  // shifts rows under the camera mid-shot.
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = async () => new Promise(() => {});
  }
};

async function newConsoleContext(browser, label) {
  const interceptor = createInterceptor({ label, readOnly: true, mask: !IS_LOCAL });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    // Denied outright, so nothing can prompt even if the page asks.
    permissions: [],
  });
  await context.addInitScript(HYGIENE);
  await interceptor.install(context);
  return { context, interceptor };
}

/** Wait until the screen has actually finished drawing, not merely navigated. */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle').catch(() => {});
  // The console draws skeletons while a query is in flight. A slide of skeleton
  // bars is worse than no slide, so wait them out.
  await page
    .waitForFunction(
      () => !document.querySelector('.animate-pulse, [data-slot="skeleton"]'),
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.waitForTimeout(700);
}

async function signIn(page, { email, password }) {
  await page.goto(`${SITE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30000 });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  // Landing differs by role — ops goes to `/`, a vendor to `/portal/tickets` —
  // so wait for the login form to go away rather than for a specific URL.
  await page.waitForSelector('#email', { state: 'detached', timeout: 45000 });
  await settle(page);
}

/** The id of the first row that links to `pattern`, so shots can open a real record. */
async function firstLinked(page, pattern) {
  const href = await page.evaluate((p) => {
    const link = [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .find((h) => new RegExp(p).test(h));
    return link ?? null;
  }, pattern);
  return href;
}

// ── The ops console, as a company admin ───────────────────────────────────────

const ADMIN_SCREENS = [
  ['console-dashboard', '/', 'Operations, on one screen', 'Counted, and scoped to what this manager covers'],
  ['console-tickets', '/tickets', 'Every job, filterable', ''],
  ['console-escalations', '/escalations', 'What is about to be missed', 'Open windows soonest-first; missed ones newest-first'],
  ['console-approvals', '/approvals', 'Vendor products await a price', 'Unpriced means unticketable'],
  ['console-technicians', '/technicians', 'The technician master', ''],
  ['console-ledger', '/ledger', 'The penalty and bonus pool', 'A closed circuit: penalties fund it, bonuses spend it'],
  ['console-vendors', '/vendors', 'The vendors who raise the work', ''],
  ['console-territory', '/territory', 'Region, state, district, pincode', 'Nobody assigns their own territory'],
  ['console-categories', '/categories', 'The product master', 'A tree of any depth; only the last floor holds products'],
  ['console-rules', '/settings/rules', 'Every penalty is a setting', 'Per company, and overridable per category'],
  ['console-users', '/settings/users', 'Roles and access', ''],
  ['console-notifications', '/notifications', 'What needs a person', ''],
];

async function captureAdmin({ browser, recorder }) {
  const { context, interceptor } = await newConsoleContext(browser, 'console/admin');
  const page = await context.newPage();

  // Signed out, before any session exists.
  await page.goto(`${SITE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30000 });
  await settle(page);
  await recorder.record({
    id: 'console-login',
    section: 'Ops console',
    title: 'One console, every role',
    sub: 'Email and password, or Google',
    kind: 'console',
    target: page,
  });

  await signIn(page, credentials('admin'));

  for (const [id, route, title, sub] of ADMIN_SCREENS) {
    await page.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await recorder.record({ id, section: 'Ops console', title, sub, kind: 'console', target: page });
  }

  // A real ticket, opened from the list rather than by guessing an id.
  await page.goto(`${SITE}/tickets`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const ticketHref = await firstLinked(page, '^/tickets/[^/]+$');
  if (ticketHref) {
    await page.goto(`${SITE}${ticketHref}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await recorder.record({
      id: 'console-ticket-detail',
      section: 'Ops console',
      title: 'Every ticket answers for itself',
      sub: 'The timeline is the audit trail, not the status column',
      kind: 'console',
      target: page,
    });
    // The screen that carries customer data — prove the mask fired on it.
    interceptor.assertMasked('/tickets/');
  }

  await page.goto(`${SITE}/technicians`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const techHref = await firstLinked(page, '^/technicians/[^/]+$');
  if (techHref) {
    await page.goto(`${SITE}${techHref}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await recorder.record({
      id: 'console-technician-profile',
      section: 'Ops console',
      title: 'Skills, coverage and bandwidth',
      sub: '',
      kind: 'console',
      target: page,
    });
  }

  interceptor.assertNoWrites();
  await context.close();
  return ticketHref;
}

// ── The same console, as an area manager ──────────────────────────────────────

async function captureAreaManager({ browser, recorder, ticketHref }) {
  const { context, interceptor } = await newConsoleContext(browser, 'console/area-manager');
  const page = await context.newPage();

  await signIn(page, credentials('area_manager'));

  await recorder.record({
    id: 'console-am-dashboard',
    section: 'Ops console — area manager',
    title: 'The rail narrows by role',
    sub: 'An area manager sees his states, and only his states',
    kind: 'console',
    target: page,
  });

  await page.goto(`${SITE}/escalations`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await recorder.record({
    id: 'console-am-escalations',
    section: 'Ops console — area manager',
    title: 'The queue he actually works',
    sub: '',
    kind: 'console',
    target: page,
  });

  // The three action forms. Opening one is a GET; nothing is ever submitted,
  // and the interceptor would abort the POST if a future edit tried.
  const target = ticketHref ?? (await firstLinked(page, '^/tickets/[^/]+$'));
  if (target) {
    for (const [id, suffix, title, sub] of [
      ['console-assign', '/assign', 'Assigning by hand', 'When nobody in the pool took it'],
      ['console-bonus', '/bonus', 'Funding a bonus re-publishes it', 'Paid out of the penalty pool'],
      ['console-force-close', '/force-close', 'Force-closure is answerable', 'A reason, a justification and an attachment — kept for audit'],
    ]) {
      await page.goto(`${SITE}${target}${suffix}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await recorder.record({
        id,
        section: 'Ops console — area manager',
        title,
        sub,
        kind: 'console',
        target: page,
      });
    }
  }

  interceptor.assertNoWrites();
  await context.close();
}

// ── The vendor portal ─────────────────────────────────────────────────────────

async function captureVendor({ browser, recorder }) {
  const { context, interceptor } = await newConsoleContext(browser, 'console/vendor');
  const page = await context.newPage();

  await signIn(page, credentials('vendor'));

  for (const [id, route, title, sub] of [
    ['portal-tickets', '/portal/tickets', 'The vendor sees their own work', 'A sub-user sees only what they raised themselves'],
    ['portal-new-ticket', '/portal/tickets/new', 'Only a vendor raises a ticket', 'Company staff work tickets; they no longer create them'],
    ['portal-products', '/portal/products', 'The catalogue they can raise against', ''],
    ['portal-users', '/portal/users', 'Their own people', ''],
  ]) {
    await page.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await recorder.record({ id, section: 'Vendor portal', title, sub, kind: 'console', target: page });
  }

  await page.goto(`${SITE}/portal/tickets`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const href = await firstLinked(page, '^/portal/tickets/[^/]+$');
  if (href) {
    await page.goto(`${SITE}${href}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await recorder.record({
      id: 'portal-ticket-detail',
      section: 'Vendor portal',
      title: 'They can watch it, not work it',
      sub: '',
      kind: 'console',
      target: page,
    });
  }

  interceptor.assertNoWrites();
  await context.close();
}

export async function captureConsole({ browser, recorder }) {
  const ticketHref = await captureAdmin({ browser, recorder });
  await captureAreaManager({ browser, recorder, ticketHref });
  await captureVendor({ browser, recorder });
}
