/**
 * The REAL technician app, running on the web, against the seeded development
 * tenant.
 *
 * Two processes must already be up; this target checks and explains rather than
 * starting them:
 *
 *   1. The API, locally, on development — its own default, no override needed:
 *        cd api && ./.venv/Scripts/python.exe run.py
 *
 *   2. Expo on the web:
 *        cd mobileapp && npm run web        # http://localhost:8081
 *
 * Sign-in is by OTP, because the phone IS the credential and there is no
 * password to use instead. `OTP_DEV_ECHO` — on by default locally — returns the
 * code in the response, and the seeded technician's number is outside
 * `WHATSAPP_ALLOWLIST`, so the message is dropped rather than sent. Nobody is
 * messaged.
 *
 * Everything after sign-in is read-only: the guard aborts any write, so a stray
 * click cannot change the state of a job between one screenshot and the next.
 */

import { createInterceptor } from './lib/guard.mjs';
import { credentials, env } from './lib/env.mjs';

const APP = env('DECK_APP_URL', 'http://localhost:8081');
const API = env('DECK_LOCAL_API', 'http://127.0.0.1:8000/api/v1');

/** A phone, at the density the deck wants. */
const VIEWPORT = { width: 392, height: 812 };

async function assertUp(url, what, hint) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok && response.status >= 500) throw new Error(String(response.status));
  } catch {
    throw new Error(`${what} is not reachable at ${url}.\n     ${hint}`);
  }
}

/** Sign in to the local API from Node, to discover who to sign in as in the app. */
async function apiSignIn({ email, password }) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`local API sign-in failed: ${payload.message ?? response.status}`);
  return payload.data.accessToken;
}

/**
 * A technician who actually has work, so the app's screens are not all empty
 * states. The seeder names one in `deck/.env`; otherwise look for somebody on a
 * live ticket, and fall back to the first active technician.
 */
async function findTechnician(token) {
  const seeded = env('DECK_TECHNICIAN_PHONE');
  if (seeded) return { phone: seeded, ticketCode: null, ticketId: null };

  const get = async (path) => {
    const response = await fetch(`${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return (await response.json()).data;
  };

  for (const status of ['In Progress', 'Assigned']) {
    const page = await get(`/tickets?status=${encodeURIComponent(status)}&limit=20`);
    const rows = page?.items ?? page ?? [];
    for (const ticket of rows) {
      const phone = ticket.technicianPhone ?? ticket.assignedTechnician?.phone;
      if (phone) return { phone, ticketCode: ticket.code, ticketId: ticket.id };
    }
  }

  const list = await get('/technicians?limit=20');
  const rows = list?.items ?? list ?? [];
  const first = rows.find((row) => row.phone);
  if (!first) {
    throw new Error('no technician with a phone number found on the production database');
  }
  return { phone: first.phone, ticketCode: null, ticketId: null };
}

/** Drive the app's own OTP screen, reading the echoed code off the response. */
async function signInToApp(page, phone) {
  let devCode = null;
  page.on('response', async (response) => {
    if (!response.url().includes('/auth/otp/')) return;
    try {
      const body = await response.json();
      devCode = body?.data?.devCode ?? devCode;
    } catch {
      /* not JSON, not our code */
    }
  });

  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // The login screen is one screen with two steps. Type the number, continue,
  // then read back the code the local API echoed.
  const national = String(phone).replace(/^\+91/, '');
  await page.getByRole('textbox').first().fill(national);
  await page.getByText(/send otp|continue|get otp/i).first().click();

  await page.waitForFunction(() => true, { timeout: 1000 }).catch(() => {});
  for (let attempt = 0; attempt < 30 && !devCode; attempt += 1) {
    await page.waitForTimeout(400);
  }
  if (!devCode) {
    throw new Error(
      'the local API did not echo an OTP. Check OTP_DEV_ECHO is on and that the ' +
        'API really is the LOCAL one — the deployed API never echoes.',
    );
  }

  const boxes = page.getByRole('textbox');
  const count = await boxes.count();
  if (count >= 6) {
    for (let index = 0; index < 6; index += 1) {
      await boxes.nth(index).fill(devCode[index]);
    }
  } else {
    await boxes.first().fill(devCode);
  }
  await page.getByText(/verify|continue/i).first().click();
  await page.waitForTimeout(3500);
}

const SCREENS = [
  ['app-home', '/', "Today's work, at a glance", ''],
  ['app-jobs', '/jobs', 'Upcoming, in progress, completed', ''],
  ['app-pool', '/pool', 'Only jobs they can actually do', 'Matched on skill, pincode and remaining capacity'],
  ['app-earnings', '/earnings', 'Every rupee, itemised', 'Payouts, bonuses and penalties in one ledger'],
  ['app-availability', '/availability', 'The technician sets their own cap', 'Jobs per day, counted by slot date'],
  ['app-profile', '/profile', '', ''],
];

export async function captureMobile({ browser, recorder }) {
  await assertUp(
    `${API.replace(/\/api\/v1$/, '')}/docs`,
    'the local API',
    'start it with: cd api && ./.venv/Scripts/python.exe run.py',
  );
  await assertUp(APP, 'the Expo web server', 'start it with: cd mobileapp && npm run web');

  // Every customer on these screens was invented in seed/fixtures.mjs, so there
  // is nothing to pseudonymise — see the note in capture/console.mjs.
  const interceptor = createInterceptor({ label: 'mobile', readOnly: true, mask: false });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true,
  });
  await interceptor.install(context);

  // Metro bundles the whole app on the first request and can take minutes doing
  // it. Playwright's 30-second default turns that into a navigation timeout
  // that looks like the app is broken.
  context.setDefaultNavigationTimeout(240000);
  context.setDefaultTimeout(60000);

  const page = await context.newPage();

  const token = await apiSignIn(credentials('admin'));
  const technician = await findTechnician(token);

  process.stdout.write('  … waiting for Metro to bundle the app (first run is slow)\n');
  await signInToApp(page, technician.phone);

  for (const [id, route, title, sub] of SCREENS) {
    await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await recorder.record({
      id,
      section: 'Technician app',
      title: title || route,
      sub,
      kind: 'phone-raw',
      target: page,
    });
  }

  /**
   * Ids for the two detail screens, read through the technician's OWN session
   * inside the page rather than guessed — these are the same lists the Jobs tab
   * and the pool screen render.
   */
  const idFrom = async (endpoint) =>
    page
      .evaluate(async ([base, path]) => {
        try {
          const raw = window.localStorage.getItem('reliancegreentech.session');
          const token = raw ? JSON.parse(raw)?.state?.accessToken : null;
          const response = await fetch(`${base}${path}`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
          const body = await response.json();
          const rows = body?.data?.items ?? body?.data ?? [];
          return rows[0]?.id ?? rows[0]?.ticketId ?? null;
        } catch {
          return null;
        }
      }, [API, endpoint])
      .catch(() => null);

  // The masked offer, from the running app. Customer name and phone are still
  // hidden here — this technician has not accepted it — which is the product
  // doing its own masking rather than the deck doing it for them.
  const offerId = await idFrom('/jobs/pool');
  if (offerId) {
    await page.goto(`${APP}/pool/${offerId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await recorder.record({
      id: 'app-offer',
      section: 'Technician app',
      title: 'Masked until accepted',
      sub: 'Name, phone and address stay hidden — the slot does not',
      kind: 'phone-raw',
      target: page,
    });
  }

  // The accept sheet, from the running app. It is opened by PRESSING the button
  // on the offer screen rather than by navigating to the modal route directly:
  // the sheet is transparent, so a direct navigation renders it over a blank
  // grey page instead of over the offer it belongs to.
  //
  // Pressing "Accept job" only opens the sheet. The write happens on
  // "Accept & unlock details" inside it, which we never touch — and which the
  // guard would abort even if a future edit did.
  if (offerId) {
    await page.goto(`${APP}/pool/${offerId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.getByText(/^accept job/i).first().click();
    await page.waitForTimeout(1400);
    await recorder.record({
      id: 'app-accept-sheet',
      section: 'Technician app',
      title: 'First accept wins',
      sub: 'Losing the race is a normal outcome, not an error',
      kind: 'phone-raw',
      target: page,
    });
  }

  const jobId = await idFrom('/jobs/mine');

  if (jobId ?? technician.ticketId) {
    await page.goto(`${APP}/job/${jobId ?? technician.ticketId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await recorder.record({
      id: 'app-job-detail',
      section: 'Technician app',
      title: 'Accepted — the customer is revealed',
      sub: '',
      kind: 'phone-raw',
      target: page,
    });
    interceptor.assertMasked('/jobs/');
  }

  interceptor.assertNoWrites();
  await context.close();
}
