/**
 * The two pages the customer actually sees — the slot picker and the feedback
 * form that closes the job.
 *
 * Captured against DEVELOPMENT, against the tenant `seed/seed_dev.mjs` builds.
 * These pages are reached by a single-use token that arrives over WhatsApp, so
 * producing one in production would mean messaging a real customer, and opening
 * an existing live token risks spending somebody's pending confirmation. The
 * HTML is identical either way — both are server-rendered with inline CSS
 * (`api/app/features/tickets/slot_page.py`, `feedback_page.py`) and the only
 * difference is the company name and monogram, which are white-labelled from
 * the tenant in both environments.
 *
 * The seeder leaves both states waiting, so this reads tokens rather than
 * creating anything.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { env } from './lib/env.mjs';
import { REPO_ROOT, DECK_ROOT } from './lib/shot.mjs';

const API = env('DECK_DEV_API', 'http://127.0.0.1:8000/api/v1');
const ORIGIN = API.replace(/\/api\/v1$/, '');
const VIEWPORT = { width: 392, height: 812 };

/** Read-only, and it refuses to run against a database whose name says "prod". */
function devTokens() {
  const python = path.join(REPO_ROOT, 'api', '.venv', 'Scripts', 'python.exe');
  const script = path.join(DECK_ROOT, 'capture', 'dev_tokens.py');
  return JSON.parse(execFileSync(python, [script], { encoding: 'utf8' }));
}

export async function captureCustomer({ browser, recorder }) {
  if (!/127\.0\.0\.1|localhost/.test(API)) {
    throw new Error(
      `refusing to touch customer tokens on ${API} — these pages are captured on development only`,
    );
  }

  const tokens = devTokens();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  // ── The slot picker ────────────────────────────────────────────────────────
  if (tokens.slot?.token) {
    const url = `${ORIGIN}/slot/${tokens.slot.token}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await recorder.record({
      id: 'customer-slot',
      section: 'Customer touchpoints',
      title: 'The customer picks the slot',
      sub: 'Before any technician has seen the job',
      kind: 'phone-raw',
      target: page,
    });

    // Choosing a window is the customer's own action, and the only
    // unauthenticated write in the product. It SPENDS the token, which is why
    // the seeder leaves two tickets waiting rather than one.
    //
    // Each window is its own submit button carrying the chosen time as its
    // value — there is no separate confirm step, which is the whole point of
    // the page: one tap, on a phone, on a bad connection.
    const option = page.locator('button[name="start"]').first();
    if (await option.count()) {
      await option.click();
      await page.waitForTimeout(1200);
      await recorder.record({
        id: 'customer-slot-confirmed',
        section: 'Customer touchpoints',
        title: 'Confirmed, and nobody was called',
        sub: '',
        kind: 'phone-raw',
        target: page,
      });
    }
  } else {
    process.stdout.write('  ! no ticket waiting on a slot — re-run seed/seed_dev.mjs --reset\n');
  }

  // ── The feedback form ──────────────────────────────────────────────────────
  if (tokens.feedback?.token) {
    await page.goto(`${ORIGIN}/feedback/${tokens.feedback.token}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(700);
    await recorder.record({
      id: 'customer-feedback',
      section: 'Customer touchpoints',
      title: 'Only the customer closes it',
      sub: 'A technician cannot mark their own work done',
      kind: 'phone-raw',
      target: page,
    });
    // Deliberately NOT submitted. Answering closes the job and spends the
    // token, and the seeder leaves exactly one in this state.
  } else {
    process.stdout.write('  ! no job awaiting the customer — re-run seed/seed_dev.mjs --reset\n');
  }

  await context.close();
}
