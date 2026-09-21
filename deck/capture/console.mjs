/**
 * The ops console and the vendor portal.
 *
 * `DECK_CONSOLE_URL` decides which one, and the default is the LOCAL console on
 * :5173 reading the local API and the tenant `seed/seed_dev.mjs` built on the
 * development database. Point it at the deployed site instead and these become
 * production screens with production volumes, at which point masking switches
 * itself back on — see `IS_LOCAL` below.
 *
 * ⚠ The deployed console is on Azure, not Netlify. The old
 * `reliancegreentech.netlify.app` address named here until the move on
 * 2026-09-18 no longer serves the app.
 *
 * Every context here carries the interceptor from `lib/guard.mjs`: customer PII
 * is pseudonymised in the response body, and any write the shot list did not
 * mean to make is aborted before it reaches the database.
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
  // Shipped after the first capture and never photographed: the two screens
  // where money crosses the company's boundary.
  ['console-credits', '/credits', 'Tickets are paid for in credits', 'Charged when a ticket is raised, and never refunded'],
  ['console-redemptions', '/redemptions', 'Technicians cashing out', 'Paid by UPI, from the payer’s own phone'],
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

    // "Change the time" opens a dialog, not a route. Rescheduling is the third
    // thing a manager can do with a stuck job and the only one that clears the
    // queue's missed half, and it had no screenshot anywhere in the deck.
    const opened = await openDialog(page, /change the time/i);
    if (opened) {
      await recorder.record({
        id: 'console-reschedule',
        section: 'Ops console',
        title: 'A slot can move',
        sub: 'With the customer’s agreement, a written reason, and nothing charged',
        kind: 'console',
        target: page,
      });
      await page.keyboard.press('Escape').catch(() => {});
      await settle(page);
    }
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

  // One redemption, opened from the queue. The UPI QR only exists while nobody
  // has paid yet, which is why the seed leaves it unclaimed.
  await page.goto(`${SITE}/redemptions`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  // Not `firstLinked`: the table navigates with `onRowClick` rather than an
  // anchor, so there is no href on the page to read. Clicking the row is the
  // only way in, and it is a read either way.
  const opened = await openFirstRow(page, /\/redemptions\/[0-9a-f-]{8,}/);
  if (opened) {
    await recorder.record({
      id: 'console-redemption',
      section: 'Ops console',
      title: 'Scan, pay, and say so',
      sub: 'Only the technician can confirm it arrived',
      kind: 'console',
      target: page,
    });
  }

  // The serial list lives in a dialog on a model, not on a route of its own —
  // so it has to be clicked open, the same way the accept sheet is on mobile.
  await page.goto(`${SITE}/categories`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const serialPanel = await openModelSerials(page);
  if (serialPanel) {
    await recorder.record({
      id: 'console-model-serials',
      section: 'Ops console',
      title: 'The serials a model covers',
      sub: 'An empty list means unchecked, not “nothing matches”',
      kind: 'console',
      target: page,
    });
  } else {
    process.stdout.write('  ! could not open the serials panel — skipped\n');
  }

  interceptor.assertNoWrites();
  await context.close();
  return ticketHref;
}

/**
 * Click a control open and wait for its dialog, tolerantly.
 *
 * Returns false rather than throwing: a button that moved or a ticket in the
 * wrong status must cost the deck one screenshot, not the other twenty. Opening
 * a dialog is a read — nothing is submitted, and the write guard would abort it
 * if a future edit tried.
 */
async function openDialog(page, label) {
  try {
    const control = page.getByRole('button', { name: label }).first();
    if (!(await control.count())) return false;
    await control.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
    await settle(page);
    return true;
  } catch {
    return false;
  }
}

/**
 * Click the first row of a table that navigates by `onRowClick`.
 *
 * ⚠ `waitForURL` matches the WHOLE url, origin included. A pattern anchored
 * with `^/redemptions/` therefore never matches `http://localhost:5173/...`
 * and the shot is silently skipped — which is exactly what happened.
 */
async function openFirstRow(page, urlPattern) {
  try {
    const row = page.locator('tbody tr').first();
    if (!(await row.count())) return false;
    await row.click();
    await page.waitForURL(urlPattern, { timeout: 10000 });
    await settle(page);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a product model for EDIT, which is where the serials panel lives.
 *
 * It is not on ADD — a serial needs a model id that does not exist until the
 * product is saved — so the only way to photograph it is to edit a real one.
 *
 * Deliberately tolerant: it returns false rather than throwing, because one
 * dialog that moved must not cost the deck its other twenty console screens.
 * Every step is a read; opening a dialog submits nothing, and the write guard
 * would abort it if a future edit tried.
 */
async function openModelSerials(page) {
  try {
    // The tree arrives expanded, and each product is a BUTTON that opens a
    // menu — not the dialog. "Edit product" on that menu is what opens it.
    const model = page.getByRole('button', { name: /Meridian 43/ }).first();
    if (!(await model.count())) return false;
    await model.scrollIntoViewIfNeeded().catch(() => {});
    await model.click();

    const edit = page.getByRole('menuitem', { name: /edit product/i }).first();
    if (await edit.count()) await edit.click();
    else await page.getByText(/edit product/i).first().click();

    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    // The panel is what we came for; a dialog without it is the wrong one.
    await page.getByText(/serial numbers/i).first().waitFor({ timeout: 8000 });
    await settle(page);
    return true;
  } catch {
    return false;
  }
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
    ['portal-brands', '/portal/brands', 'A vendor sells several brands', 'A product carries exactly one, and it waits for your approval'],
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
