/**
 * Build a complete demo tenant on the DEVELOPMENT database, through the API.
 *
 *   node seed/seed_dev.mjs
 *
 * A company, its staff, a vendor with a login, three technicians, a product
 * catalogue with real prices, and thirteen tickets driven to seven different
 * points of the lifecycle — so the console's dashboard counts something, the
 * escalation queue has a row, the ledger has both a payout and a penalty, the
 * job pool has work in it, and the two customer-facing pages have live tokens.
 *
 * Everything invented lives in `fixtures.mjs`. Every write goes through the real
 * endpoints, so prices and the rules snapshot are stamped at intake and each
 * change writes its own `ticket_events` row — data inserted behind the API's
 * back would look right on a screen and be wrong underneath.
 *
 * Credentials are written to `seed/credentials.json` (git-ignored) and appended
 * to `deck/.env`, so the capture step needs nothing typed in by hand.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { DECK_ROOT, REPO_ROOT } from '../capture/lib/shot.mjs';
import {
  assertDevelopment, call, login, adoptPassword, technicianLogin, upload, ORIGIN,
} from './api.mjs';
import {
  COMPANY, DEMO_PASSWORD, STAFF, VENDOR, TECHNICIANS, CATALOGUE, CUSTOMERS, TICKET_PLAN,
} from './fixtures.mjs';

const log = (message) => process.stdout.write(`${message}\n`);
const step = (message) => process.stdout.write(`\n▸ ${message}\n`);

const SUPERADMIN = {
  email: process.env.DECK_SUPERADMIN_EMAIL ?? 'superadmin@reliancegreentech.com',
  password: process.env.DECK_SUPERADMIN_PASSWORD ?? 'ChangeMe_Superadmin@123',
};

/**
 * Get a usable session for a just-created account, and leave its password set
 * to the shared demo one.
 *
 * `temporaryPassword` comes back only when the email could not be sent, which an
 * address off `ACS_EMAIL_ALLOWLIST` guarantees. It is also absent on a re-seed:
 * a user identity is global and outlives the company, so `--reset` leaves the
 * person there with the password the previous run already set. Both paths end in
 * the same place.
 */
async function accessFor(email, result, who) {
  const temporary = result?.temporaryPassword;
  if (temporary) return adoptPassword(email, temporary, DEMO_PASSWORD);

  try {
    return await login(email, DEMO_PASSWORD);
  } catch {
    throw new Error(
      `no temporary password came back for ${who}, and "${DEMO_PASSWORD}" does not ` +
        `work either. The identity exists from an earlier run with a different ` +
        `password — reissue it from Users & roles, or use a fresh address.`,
    );
  }
}

/**
 * Take the previous demo tenant down, in the order its unique constraints
 * require.
 *
 * Deleting the company is not enough. A technician's PHONE is an identity —
 * `uq_users_phone_technician` is partial on `role = 'technician'` — and a
 * vendor's GSTIN is unique too. Both outlive the company, so a second run
 * would 409 on the first technician. Each UNIQUE here is partial on
 * `deleted_at IS NULL`, which is exactly why deleting the rows frees the values
 * rather than burying them.
 *
 * Everything is matched through the company we already identified by its exact
 * demo name, on a database proved to be development. Nothing else is touched.
 */
async function resetCompany(superadmin, company) {
  try {
    const admin = await login(COMPANY.email, DEMO_PASSWORD);

    const technicians = await call('/technicians?limit=100', { token: admin });
    const rows = technicians.items ?? technicians;
    for (const row of rows) {
      await call(`/technicians/${row.id}`, { token: admin, method: 'DELETE' });
      // The profile is not what holds the phone — the USER row is, and deleting
      // the technician does not take it with it. Without this the next run 409s
      // on the first phone number with nothing on screen to explain why.
      if (row.membershipId) {
        await call(`/users/${row.membershipId}`, { token: admin, method: 'DELETE' })
          .catch(() => {});
      }
    }
    log(`    removed ${rows.length} technician(s)`);

    // Vendors are deliberately left alone. Deleting one is refused while it is
    // the brand on any product model, and the company delete below releases its
    // GSTIN anyway — every UNIQUE here is partial on `deleted_at IS NULL`.
  } catch (error) {
    // Worth saying out loud rather than swallowing: if the identities survive,
    // the next step fails with a 409 that would otherwise look mysterious.
    log(`    ! could not clean up inside the company (${error.message.split('\n')[0]})`);
  }

  await call(`/companies/${company.id}`, { token: superadmin, method: 'DELETE' });
  log(`    removed the previous "${COMPANY.name}"`);

  // Belt and braces. Any technician user the steps above did not reach still
  // holds its phone number, and the next run would 409 on it. Scoped to the
  // numbers in fixtures.mjs and to a database already proved to be development.
  const freed = freeTechnicianPhones(TECHNICIANS.map((t) => t.phone));
  if (freed) log(`    freed ${freed} technician phone number(s)`);
}

// ── Geography ────────────────────────────────────────────────────────────────

/** Pick a real state from the loaded master, and enough pincodes to cover with. */
async function pickTerritory(token) {
  const states = await call('/geo/states', { token });
  const rows = states.items ?? states;
  const state =
    rows.find((s) => s.name?.toLowerCase() === COMPANY.state.toLowerCase()) ?? rows[0];
  if (!state) throw new Error('the geography master is empty — import it on Super Admin → Geography');

  const page = await call(`/geo/pincodes?stateId=${state.id}&limit=40`, { token });
  const pincodes = (page.items ?? page).map((p) => p.code ?? p.pincode).filter(Boolean);
  if (pincodes.length < 4) throw new Error(`only ${pincodes.length} pincodes under ${state.name}`);

  return { state, regionId: state.regionId, pincodes: pincodes.slice(0, 12) };
}

// ── Catalogue ────────────────────────────────────────────────────────────────

/**
 * Both node and model creation answer with the whole ROOT SUBTREE the change
 * landed in — `_one_root`, not the row itself — so the new id has to be found
 * inside it. Catalogue names are unique here, which makes a plain recursive
 * search unambiguous.
 */
function findNode(tree, name) {
  if (tree.name === name) return tree;
  for (const child of tree.children ?? []) {
    const hit = findNode(child, name);
    if (hit) return hit;
  }
  return null;
}

function findModel(tree, name) {
  for (const model of tree.models ?? []) if (model.name === name) return model;
  for (const child of tree.children ?? []) {
    const hit = findModel(child, name);
    if (hit) return hit;
  }
  return null;
}

async function createCatalogue(token, vendorId) {
  const certifyIds = [];
  const leaves = [];

  const walk = async (spec, parentId) => {
    const root = await call('/masters/nodes', {
      token,
      method: 'POST',
      body: {
        name: spec.name,
        parentId: parentId ?? null,
        isLeaf: Boolean(spec.isLeaf),
      },
    });
    const node = findNode(root, spec.name);
    if (!node) throw new Error(`created "${spec.name}" but could not find it in the returned tree`);
    log(`    node  ${spec.name}${spec.isLeaf ? '  (leaf)' : ''}`);

    // A technician certifies on a MAIN sub-category — a direct child of a root —
    // and that covers everything beneath it, at any depth, for ever.
    if (spec.certify) certifyIds.push(node.id);

    for (const model of spec.models ?? []) {
      const updated = await call(`/masters/nodes/${node.id}/models`, {
        token,
        method: 'POST',
        body: {
          ...model,
          vendorId,
          serviceTypes: ['Installation + Demo', 'Tech Visit', 'Service'],
        },
      });
      const created = findModel(updated, model.name);
      if (!created) throw new Error(`created model "${model.name}" but could not find it in the returned tree`);
      leaves.push({ subcategoryId: node.id, modelId: created.id, name: model.name });
      log(`    model ${model.name}  ₹${(model.technicianPayoutPaise / 100).toFixed(0)} payout`);
    }

    for (const child of spec.children ?? []) await walk(child, node.id);
  };

  for (const root of CATALOGUE) await walk(root, null);
  return { certifyIds, leaves };
}

// ── Proof images ─────────────────────────────────────────────────────────────

/**
 * Three placeholder images for the proof artifacts.
 *
 * Deliberately plain cards that SAY what they stand in for, rather than
 * anything dressed up to look like a real photograph of a real installation.
 * A proof artifact is evidence; a convincing fake one in a demo database is the
 * sort of thing that gets mistaken for the real article later.
 */
async function makeProofImages(browser) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  const images = {};

  for (const [kind, label] of [
    ['barcode', 'BARCODE'],
    ['photos', 'INSTALLED UNIT'],
    ['live', 'ON-SITE LIVE PHOTO'],
  ]) {
    await page.setContent(`
      <div style="width:800px;height:600px;display:flex;flex-direction:column;
                  align-items:center;justify-content:center;gap:14px;
                  background:#141b22;color:#93a2b0;
                  font:600 30px/1.3 system-ui,sans-serif;letter-spacing:.06em">
        <div>${label}</div>
        <div style="font:400 17px/1.4 system-ui,sans-serif;color:#5a6772">
          placeholder — demo data
        </div>
      </div>`);
    images[kind] = await page.screenshot({ type: 'png' });
  }

  await context.close();
  return images;
}

// ── Driving one ticket ───────────────────────────────────────────────────────

/**
 * Every live slot and feedback token on the development database, keyed by
 * ticket code. `dev_tokens.py` is read-only and refuses to run against a
 * database whose name contains "prod".
 */
function devHelper(...args) {
  const python = path.join(REPO_ROOT, 'api', '.venv', 'Scripts', 'python.exe');
  const script = path.join(DECK_ROOT, 'capture', 'dev_tokens.py');
  return JSON.parse(execFileSync(python, [script, ...args], { encoding: 'utf8' }));
}

function devTicketTokens() {
  return devHelper('--all').tickets ?? {};
}

/** Release seed phone numbers still held by technician users of a deleted company. */
function freeTechnicianPhones(phones) {
  return devHelper('--free-technician-phones', ...phones).freed ?? 0;
}

/** The windows the slot page offers are rendered as radio values; read them back. */
async function slotOptions(token) {
  const html = await call(`${ORIGIN}/slot/${token}`, { raw: true });
  return [...html.matchAll(/name="start"[^>]*value="([^"]+)"/g)].map((m) => m[1]);
}

async function confirmSlot(slotToken, index = 0) {
  const options = await slotOptions(slotToken);
  if (!options.length) throw new Error('the slot page offered no windows');
  const chosen = options[Math.min(index, options.length - 1)];
  await call(`${ORIGIN}/slot/${slotToken}`, { method: 'POST', form: { start: chosen }, raw: true });
  return chosen;
}

/**
 * A point per ticket, spread across Bengaluru. Giving the TICKET coordinates is
 * what a picked map result does, and it buys the stronger proof rule: the live
 * photo is then judged by DISTANCE from the customer's door rather than by
 * pincode equality, which can span kilometres.
 */
function pointFor(index) {
  return {
    latitude: Number((12.9716 + ((index % 5) - 2) * 0.012).toFixed(6)),
    longitude: Number((77.5946 + ((index % 4) - 1.5) * 0.014).toFixed(6)),
  };
}

async function submitProof(techToken, ticketId, serial, pincode, blobs, point) {
  const capturedAt = new Date().toISOString();
  const artifacts = [
    { kind: 'barcode', blobName: blobs.barcode, capturedAt },
    { kind: 'photos', blobName: blobs.photos, capturedAt, ordinal: 1 },
    {
      kind: 'live',
      blobName: blobs.live,
      capturedAt,
      accuracyM: 12,
      // The live shot must carry coordinates under either rule — without that,
      // turning location off on the phone would be the way round the gate.
      // ~20 m from the ticket's own point, which is comfortably inside the
      // company's geo radius.
      latitude: Number((point.latitude + 0.00018).toFixed(6)),
      longitude: Number((point.longitude + 0.00012).toFixed(6)),
      devicePincode: pincode,
    },
  ];
  await call(`/jobs/${ticketId}/proof`, {
    token: techToken,
    method: 'POST',
    // "scanned" drops the separate `serial` artifact — the barcode carried it.
    body: { artifacts, observedSerial: serial, observedSerialSource: 'scanned' },
  });
}

// ── The run ──────────────────────────────────────────────────────────────────

async function main() {
  const database = assertDevelopment();
  step(`Seeding ${COMPANY.name} into ${database}`);

  const credentials = { database, company: COMPANY.name, password: DEMO_PASSWORD, accounts: {} };

  // 1 — the company, created by the superadmin.
  step('Company');
  const superadmin = await login(SUPERADMIN.email, SUPERADMIN.password);

  const existing = await call('/companies', { token: superadmin });
  const already = (existing.items ?? existing).find((c) => c.name === COMPANY.name);
  if (already) {
    if (!process.argv.includes('--reset')) {
      throw new Error(
        `"${COMPANY.name}" already exists on ${database}. Re-run with --reset to ` +
          `replace it, or change COMPANY.name in seed/fixtures.mjs.`,
      );
    }
    await resetCompany(superadmin, already);
  }

  const created = await call('/companies', { token: superadmin, method: 'POST', body: COMPANY });
  const admin = await accessFor(COMPANY.email, created, 'the company admin');
  credentials.accounts.admin = { email: COMPANY.email, role: 'admin' };
  log(`    ${COMPANY.name} (${COMPANY.code})  admin ${COMPANY.email}`);

  // 2 — territory, read from the global geography master.
  step('Territory');
  const territory = await pickTerritory(admin);
  log(`    ${territory.state.name} · ${territory.pincodes.length} pincodes`);

  // 3 — staff. A regional head covers regions; an area manager covers STATES.
  step('Staff');
  for (const person of STAFF) {
    const body = { ...person };
    if (person.role === 'regional_head') body.regionIds = [territory.regionId].filter(Boolean);
    if (person.role === 'area_manager') body.stateIds = [territory.state.id];

    const result = await call('/users', { token: admin, method: 'POST', body });
    await accessFor(person.email, result, person.fullName);
    credentials.accounts[person.role] = { email: person.email, role: person.role };
    log(`    ${person.role.padEnd(14)} ${person.fullName}  ${person.email}`);
  }

  // 4 — the vendor. Its login is created with it: only a vendor raises a ticket,
  //     so a vendor without an account could never be ticketed against.
  step('Vendor');
  const vendorResult = await call('/vendors', { token: admin, method: 'POST', body: VENDOR });
  const vendorId = vendorResult.id ?? vendorResult.vendor?.id;
  const vendor = await accessFor(VENDOR.loginEmail, vendorResult, VENDOR.name);
  credentials.accounts.vendor = { email: VENDOR.loginEmail, role: 'vendor' };
  log(`    ${VENDOR.name}  ${VENDOR.loginEmail}`);

  // 5 — the catalogue. Models need the vendor, so this follows it.
  step('Catalogue');
  const { certifyIds, leaves } = await createCatalogue(admin, vendorId);

  // 6 — technicians. `dailyJobCap` is left null: no limit, which is what every
  //     new technician has, and what stops the cap blocking a seeded accept.
  step('Technicians');
  const technicians = [];
  for (const person of TECHNICIANS) {
    const row = await call('/technicians', {
      token: admin,
      method: 'POST',
      body: {
        ...person,
        subcategoryIds: certifyIds,
        pincodes: territory.pincodes,
        regionId: territory.regionId ?? null,
        dailyJobCap: null,
      },
    });
    technicians.push({ ...person, id: row.id, code: row.code });
    credentials.accounts[`technician_${technicians.length}`] = {
      phone: person.phone, role: 'technician', note: 'OTP only — no password',
    };
    log(`    ${row.code ?? ''} ${person.fullName}  ${person.phone}`);
  }

  // 7 — tickets, raised by the vendor and driven to their planned stage.
  step('Tickets');
  const browser = await chromium.launch();
  const proofImages = await makeProofImages(browser);
  await browser.close();

  const techTokens = new Map();
  const tokenFor = async (index) => {
    if (!techTokens.has(index)) techTokens.set(index, await technicianLogin(TECHNICIANS[index].phone));
    return techTokens.get(index);
  };

  const uploaded = {};
  for (const [kind, bytes] of Object.entries(proofImages)) {
    const result = await upload(admin, bytes, `${kind}.png`, 'image/png', 'proof');
    uploaded[kind] = result.blobName ?? result.name ?? result.url;
  }

  const summary = {};
  const record = (stage) => { summary[stage] = (summary[stage] ?? 0) + 1; };
  /** Jobs whose work is done, waiting for the customer to close them. */
  const toClose = [];

  for (const [index, plan] of TICKET_PLAN.entries()) {
    const customer = CUSTOMERS[index % CUSTOMERS.length];
    const leaf = leaves[index % leaves.length];
    const pincode = territory.pincodes[index % territory.pincodes.length];
    const serial = `MRD${String(240000 + index * 137).padStart(8, '0')}`;
    const expected = new Date(Date.now() + (2 + (index % 4)) * 86400000)
      .toISOString().slice(0, 10);
    const point = pointFor(index);

    const ticket = await call('/tickets', {
      token: vendor,
      method: 'POST',
      body: {
        subcategoryId: leaf.subcategoryId,
        modelId: leaf.modelId,
        serviceType: plan.serviceType,
        // Only a Tech Visit or a Service takes one, and both require it — the
        // API refuses a description on any other type rather than dropping it.
        ...(plan.description ? { description: plan.description } : {}),
        serialNumber: serial,
        customerName: customer.name,
        customerPhone: customer.phone,
        address: customer.address,
        city: COMPANY.city,
        state: territory.state.name,
        pincode,
        // Both or neither — half a point is not a place, and the API refuses it.
        ...point,
        expectedDate: expected,
        serviceLevelHours: 24,
      },
    });

    const detail = await call(`/tickets/${ticket.id}`, { token: admin });
    const slotToken = detail.slotLink?.split('/').pop();

    if (plan.stage === 'slotPending') {
      record('slotPending');
      log(`    ${detail.code}  slot pending`);
      continue;
    }

    await confirmSlot(slotToken, index % 3);

    if (plan.stage === 'pool') {
      record('pool');
      log(`    ${detail.code}  in the pool`);
      continue;
    }

    const techToken = await tokenFor(plan.technician);
    await call(`/jobs/${ticket.id}/accept`, { token: techToken, method: 'POST' });

    if (plan.stage === 'assigned') {
      record('assigned');
      log(`    ${detail.code}  assigned to ${TECHNICIANS[plan.technician].fullName}`);
      continue;
    }

    if (plan.stage === 'released') {
      // Given back after accepting. Inside the escalation window this both
      // charges the band and puts the ticket in the escalation queue — the two
      // screens that are otherwise hardest to populate.
      await call(`/jobs/${ticket.id}/cancel`, {
        token: techToken,
        method: 'POST',
        body: { reason: 'Vehicle breakdown on the way to site' },
      });
      record('released');
      log(`    ${detail.code}  released → penalty + escalation`);
      continue;
    }

    await submitProof(techToken, ticket.id, serial, pincode, uploaded, point);

    if (plan.stage === 'inProgress') {
      record('inProgress');
      log(`    ${detail.code}  in progress`);
      continue;
    }

    await call(`/jobs/${ticket.id}/complete`, { token: techToken, method: 'POST' });

    if (plan.stage === 'awaiting') {
      record('awaiting');
      log(`    ${detail.code}  awaiting the customer`);
      continue;
    }

    // The job is done and waiting on the customer. Closing it needs the feedback
    // token, which the API deliberately does not expose — nothing in the console
    // has any use for it — so those are collected and closed in one pass below.
    toClose.push({ code: detail.code, rating: plan.rating ?? 5 });
    log(`    ${detail.code}  work done, waiting to be closed`);
  }

  // 7b — the customer closes them. Same unauthenticated POST their own phone
  //      makes; it is the only thing that writes a payout into the ledger.
  if (toClose.length) {
    const tokens = devTicketTokens();
    for (const { code, rating } of toClose) {
      const token = tokens[code]?.feedback;
      if (!token) {
        record('awaiting');
        log(`    ${code}  no feedback token — left awaiting the customer`);
        continue;
      }
      await call(`${ORIGIN}/feedback/${token}`, {
        method: 'POST',
        form: { answer: 'yes', rating: String(rating), comment: 'Neat work, on time.' },
        raw: true,
      });
      record('closed');
      log(`    ${code}  closed by the customer`);
    }
  }

  // 8 — write down what was made.
  step('Credentials');
  const credentialsPath = path.join(DECK_ROOT, 'seed', 'credentials.json');
  writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
  log(`    seed/credentials.json`);

  const envPath = path.join(DECK_ROOT, '.env');
  const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const block = [
    '',
    `# ─── Written by seed/seed_dev.mjs — ${COMPANY.name} on ${database} ───`,
    `DECK_CONSOLE_URL=http://localhost:5173`,
    `DECK_ADMIN_EMAIL=${COMPANY.email}`,
    `DECK_ADMIN_PASSWORD=${DEMO_PASSWORD}`,
    `DECK_AREA_MANAGER_EMAIL=${STAFF.find((s) => s.role === 'area_manager').email}`,
    `DECK_AREA_MANAGER_PASSWORD=${DEMO_PASSWORD}`,
    `DECK_VENDOR_EMAIL=${VENDOR.loginEmail}`,
    `DECK_VENDOR_PASSWORD=${DEMO_PASSWORD}`,
    `DECK_DEV_VENDOR_EMAIL=${VENDOR.loginEmail}`,
    `DECK_DEV_VENDOR_PASSWORD=${DEMO_PASSWORD}`,
    `DECK_TECHNICIAN_PHONE=${TECHNICIANS[0].phone}`,
    '',
  ].join('\n');
  writeFileSync(envPath, existingEnv.replace(/\n# ─── Written by seed[\s\S]*$/, '') + block, 'utf8');
  log(`    deck/.env updated`);

  step('Done');
  for (const [stage, count] of Object.entries(summary)) log(`    ${String(count).padStart(2)} ${stage}`);
  log(`\n    Every account's password is ${DEMO_PASSWORD}; technicians sign in by OTP.`);
}

main().catch((error) => {
  process.stderr.write(`\n✗ ${error.message}\n`);
  process.exit(1);
});
