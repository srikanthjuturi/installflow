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
  IS_LOCAL_API,
} from './api.mjs';
import {
  COMPANY, DEMO_PASSWORD, STAFF, VENDOR, TECHNICIANS, CATALOGUE, CUSTOMERS, TICKET_PLAN,
  VENDOR_SUBUSER, VENDOR_PENDING_BRAND, VENDOR_SUBMITTED_MODEL,
  ticketSerial, spareSerial, SPARE_SERIALS_PER_MODEL,
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
}

/**
 * Hand back every identity this seed claims, so the next run can claim it again.
 *
 * A technician's identity is their PHONE; everybody else's is their EMAIL. Both
 * outlive the company — deleting it removes the memberships and leaves the user
 * rows — so both have to be released explicitly, and both are scoped to the
 * values in `fixtures.mjs` on a database already proved to be development.
 */
function releaseSeedIdentities() {
  const phones = freeTechnicianPhones(TECHNICIANS.map((t) => t.phone));
  if (phones) log(`    freed ${phones} technician phone number(s)`);

  const released = freeSeedEmails([
    COMPANY.email,
    ...STAFF.map((person) => person.email),
    VENDOR.loginEmail,
    VENDOR_SUBUSER.email,
  ]);
  if (released) log(`    freed ${released} staff address(es)`);
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

/**
 * The vendor's approved brands, by name.
 *
 * `GET /vendors/options` is the intended way to resolve a brand id without
 * reading the vendor record — it returns APPROVED brands only, which is exactly
 * the set a product may carry.
 */
async function brandIdsFor(token, vendorId) {
  const options = await call('/vendors/options', { token });
  const rows = options.items ?? options;
  const vendor = rows.find((row) => row.id === vendorId);
  if (!vendor) throw new Error(`vendor ${vendorId} is not in /vendors/options`);
  return new Map((vendor.brands ?? []).map((brand) => [brand.name, brand.id]));
}

async function createCatalogue(token, vendorId) {
  const certifyIds = [];
  const leaves = [];
  /* Required from the moment the vendor has more than one brand: the API only
     guesses when there is exactly one approved brand to guess. */
  const brandIds = await brandIdsFor(token, vendorId);

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
      const { brand, serialPrefix, ...fields } = model;
      const brandId = brandIds.get(brand);
      if (!brandId) {
        throw new Error(
          `model "${model.name}" wants brand "${brand}", which is not an approved ` +
            `brand of this vendor. Known: ${[...brandIds.keys()].join(', ') || '(none)'}`,
        );
      }
      const updated = await call(`/masters/nodes/${node.id}/models`, {
        token,
        method: 'POST',
        body: {
          ...fields,
          vendorId,
          brandId,
          serviceTypes: ['Installation + Demo', 'Tech Visit', 'Service'],
        },
      });
      const created = findModel(updated, model.name);
      if (!created) throw new Error(`created model "${model.name}" but could not find it in the returned tree`);
      leaves.push({
        subcategoryId: node.id,
        modelId: created.id,
        name: model.name,
        brand,
        serialPrefix,
      });
      log(`    model ${model.name}  ${brand}  ₹${(model.technicianPayoutPaise / 100).toFixed(0)} payout`);
    }

    for (const child of spec.children ?? []) await walk(child, node.id);
  };

  for (const root of CATALOGUE) await walk(root, null);
  return { certifyIds, leaves };
}

/**
 * Load each model's serial numbers — and this MUST run before any ticket.
 *
 * `product_model_serials` is the master data behind the serial-first intake
 * form. An EMPTY list means unchecked, which is how this could ship against a
 * live catalogue with no backfill; the flip side is that the moment a model
 * holds one serial, `POST /tickets` refuses anything not on its list. So every
 * serial the ticket loop is about to quote has to be a member here, or all
 * thirteen tickets 400.
 *
 * `serialsFor` is the single source for both: the loop below and the ticket
 * loop call it with the same `(leaf, index)`.
 */
async function loadSerials(token, leaves) {
  for (const [modelIndex, leaf] of leaves.entries()) {
    const used = TICKET_PLAN
      .map((_, index) => index)
      .filter((index) => index % leaves.length === modelIndex)
      .map((index) => ticketSerial(leaf.serialPrefix, index));

    const spare = Array.from({ length: SPARE_SERIALS_PER_MODEL }, (_, n) =>
      spareSerial(leaf.serialPrefix, modelIndex * SPARE_SERIALS_PER_MODEL + n),
    );

    const result = await call(`/masters/models/${leaf.modelId}/serials`, {
      token,
      method: 'POST',
      body: { serials: [...used, ...spare] },
    });
    log(`    ${leaf.name}  ${result.total ?? used.length + spare.length} serials`);
  }
}

/** Which model a ticket lands on, and therefore which serial it may quote. */
const leafFor = (leaves, index) => leaves[index % leaves.length];

/**
 * `PUT /settings/rules` is a whole-body replace, and the two shapes differ:
 * `RulesOut.penalty` is `[{band, amount}]` while the request takes bare rupee
 * amounts. Everything not being changed is sent back exactly as it was read.
 */
function rulesBody(rules, overrides = {}) {
  return {
    penalty: rules.penalty.map((band) => band.amount),
    penaltyCap: rules.penaltyCap,
    bonusAmounts: rules.bonusAmounts,
    aiThreshold: rules.aiThreshold,
    slaWarnAtPct: rules.slaWarnAtPct,
    slotConfirmTimeoutHours: rules.slotConfirmTimeoutHours,
    escalationTriggerHours: rules.escalationTriggerHours,
    customerWaitHours: rules.customerWaitHours,
    renotifyGraceMinutes: rules.renotifyGraceMinutes,
    slotReminderMinutes: rules.slotReminderMinutes,
    customerNoticeMinutes: rules.customerNoticeMinutes,
    geoRadiusM: rules.geoRadiusM,
    ...overrides,
  };
}

/**
 * Why one ticket is raised under a wider escalation window.
 *
 * A confirmed slot can never be nearer than `SLOT_LEAD_MINUTES` — 90 minutes —
 * because that is the earliest window `bookable_slots` will offer. The default
 * escalation trigger is now ONE hour. So a technician releasing a job can never
 * be inside the window at the moment they release it, `escalates` is always
 * false, and the queue this seed exists to photograph comes back empty.
 *
 * The rule is therefore raised for exactly one `POST /tickets` and put straight
 * back. `create_ticket` STAMPS the resolved rules onto `tickets.rules_snapshot`
 * and nothing ever rewrites it, so that one ticket keeps the wide window and
 * every other ticket — already stamped at 1 — is untouched. Raising it for the
 * whole run instead would hand every pooled job a 24-hour window and let the
 * five-minute sweep escalate the entire pool.
 *
 * `slotConfirmTimeoutHours` moves with it because the trigger must be strictly
 * nearer the slot than the confirmation timeout — validated in the schema, in
 * `validate_resolved`, and by a CHECK constraint.
 *
 * ⚠ Known cosmetic seam: the queue's header reads the COMPANY's current rule,
 * not the ticket's, so after the restore the page says one hour above a row
 * that escalated on a wider one. The alternative is leaving the demo company on
 * 24h, which would put 24/48 on the Rules screenshot where the document's table
 * says the defaults are 1 and 6 — a worse contradiction, on a page a reader
 * compares against that table.
 */
const ESCALATION_SEED_WINDOW = { escalationTriggerHours: 24, slotConfirmTimeoutHours: 48 };

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

/**
 * Both helpers below need a DIRECT database connection, which a remote run does
 * not have — `dev_tokens.py` opens psycopg against `api/.env`.
 *
 * They degrade rather than throw, because everything else in the seed works
 * perfectly well over HTTP. What is lost is named at the call site so it shows
 * up in the run's output instead of as a puzzling empty screen later.
 */
function devTicketTokens() {
  if (!IS_LOCAL_API) return {};
  return devHelper('--all').tickets ?? {};
}

/** Release seed phone numbers still held by technician users of a deleted company. */
function freeTechnicianPhones(phones) {
  if (!IS_LOCAL_API) return 0;
  return devHelper('--free-technician-phones', ...phones).freed ?? 0;
}

/** Release the seed's staff addresses, still held by users of a deleted company. */
function freeSeedEmails(emails) {
  if (!IS_LOCAL_API) return 0;
  return devHelper('--free-emails', ...emails).freed ?? 0;
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

  /* Whether or not a previous company was found. The identities outlive the
     company — that is the whole point of releasing them — so a run that finds
     nothing to delete still has to clear what the LAST run left behind, which
     is exactly the case that fails with "Email already belongs to another
     user" before a single row has been written. */
  if (process.argv.includes('--reset')) releaseSeedIdentities();

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

  // 4b — a second person at the vendor, so "a sub-user sees only the tickets
  //      they raised themselves" is a sentence the portal can demonstrate.
  const subUser = await call('/vendor/users', {
    token: vendor,
    method: 'POST',
    body: VENDOR_SUBUSER,
  });
  await accessFor(VENDOR_SUBUSER.email, subUser, VENDOR_SUBUSER.fullName);
  credentials.accounts.vendor_user = { email: VENDOR_SUBUSER.email, role: 'vendor_user' };
  log(`    sub-user  ${VENDOR_SUBUSER.fullName}  ${VENDOR_SUBUSER.email}`);

  // 4c — a brand the VENDOR submitted. Staff-added brands are approved on the
  //      spot, so this is the only way Approvals → Brands has a row in it.
  await call('/vendors/me/brands', {
    token: vendor,
    method: 'POST',
    body: { name: VENDOR_PENDING_BRAND },
  });
  log(`    brand     ${VENDOR_PENDING_BRAND}  (awaiting approval)`);

  // 5 — the catalogue. Models need the vendor AND its approved brands, so this
  //     follows both.
  step('Catalogue');
  const { certifyIds, leaves } = await createCatalogue(admin, vendorId);

  // 5b — the serial master, BEFORE any ticket quotes a serial. An empty list
  //      means unchecked; a loaded one refuses anything not on it.
  step('Serials');
  await loadSerials(admin, leaves);

  // 5c — a product the vendor submitted and nobody has priced, so `/approvals`
  //      is not an empty screen.
  step('Vendor submission');
  const submissionNode = leaves.find((leaf) => leaf.name.startsWith('Sunview'))
    ?? leaves[0];
  const vendorBrands = await brandIdsFor(admin, vendorId);
  await call(`/masters/portal/nodes/${submissionNode.subcategoryId}/models`, {
    token: vendor,
    method: 'POST',
    body: {
      name: VENDOR_SUBMITTED_MODEL.name,
      brandId: vendorBrands.get(VENDOR_SUBMITTED_MODEL.brand),
      serviceTypes: ['Installation + Demo'],
      capacity: VENDOR_SUBMITTED_MODEL.capacity,
      warrantyMonths: VENDOR_SUBMITTED_MODEL.warrantyMonths,
      notes: VENDOR_SUBMITTED_MODEL.notes,
    },
  });
  log(`    ${VENDOR_SUBMITTED_MODEL.name}  (awaiting a price)`);

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

  const baseRules = await call('/settings/rules', { token: admin });
  let widened = false;

  for (const [index, plan] of TICKET_PLAN.entries()) {
    // Widen for the one ticket that has to end up in the escalation queue, and
    // only for its intake — the snapshot is taken there and never revisited.
    if (plan.stage === 'released' && !widened) {
      await call('/settings/rules', {
        token: admin,
        method: 'PUT',
        body: rulesBody(baseRules, ESCALATION_SEED_WINDOW),
      });
      widened = true;
      log(`    escalation window widened to ${ESCALATION_SEED_WINDOW.escalationTriggerHours}h for this ticket`);
    }

    const customer = CUSTOMERS[index % CUSTOMERS.length];
    const leaf = leafFor(leaves, index);
    const pincode = territory.pincodes[index % territory.pincodes.length];
    // The SAME expression `loadSerials` used, so the number quoted here is one
    // this model actually carries. Intake refuses it otherwise.
    const serial = ticketSerial(leaf.serialPrefix, index);
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
      const released = await call(`/jobs/${ticket.id}/cancel`, {
        token: techToken,
        method: 'POST',
        body: { reason: 'Vehicle breakdown on the way to site' },
      });
      // Assert rather than hope. When the trigger moved 4h → 1h this stopped
      // escalating and nothing said so: the ticket went quietly back to the
      // pool, and the only symptom was an empty queue in a finished deck.
      if (released.escalates === false) {
        throw new Error(
          `${detail.code} was released but did not escalate — the escalation ` +
            `queue will photograph empty. The stamped window was ` +
            `${ESCALATION_SEED_WINDOW.escalationTriggerHours}h; check that the ` +
            `widen step above ran before this ticket was raised.`,
        );
      }
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
    // `id` and the payout are carried so a remote run can force-close instead;
    // the ceiling is the ticket's own stamped payout, enforced server-side.
    toClose.push({
      code: detail.code,
      id: ticket.id,
      rating: plan.rating ?? 5,
      payoutPaise: detail.technicianPayoutPaise ?? null,
    });
    log(`    ${detail.code}  work done, waiting to be closed`);
  }

  // Back to the company's real rules. The escalated ticket keeps the window it
  // was stamped with; every screen from here on reads the defaults.
  if (widened) {
    await call('/settings/rules', { token: admin, method: 'PUT', body: rulesBody(baseRules) });
    log(`    escalation window restored to ${baseRules.escalationTriggerHours}h`);
  }

  // 7b — the customer closes them. Same unauthenticated POST their own phone
  //      makes; it is the only thing that writes a payout into the ledger.
  //
  // ⚠ `feedback_token` is deliberately not exposed by any endpoint — nothing in
  // the console needs it — so a REMOTE run cannot reach it and cannot close a
  // job as the customer. Rather than leave the ledger empty (which would take
  // the earnings figures, the redemption and the pool balance with it), those
  // tickets are FORCE-CLOSED by a manager instead. That is a real, supported
  // ending, and it is honest about which one it is: a force-closed job reads as
  // force-closed everywhere, and the customer-feedback page stays uncaptured.
  if (toClose.length) {
    const tokens = devTicketTokens();
    let forced = 0;
    for (const { code, rating, id, payoutPaise } of toClose) {
      const token = tokens[code]?.feedback;
      if (token) {
        await call(`${ORIGIN}/feedback/${token}`, {
          method: 'POST',
          form: { answer: 'yes', rating: String(rating), comment: 'Neat work, on time.' },
          raw: true,
        });
        record('closed');
        log(`    ${code}  closed by the customer`);
        continue;
      }

      if (!id) {
        record('awaiting');
        log(`    ${code}  no feedback token — left awaiting the customer`);
        continue;
      }

      await call(`/tickets/${id}/force-close`, {
        token: admin,
        method: 'POST',
        body: {
          reason: 'Customer did not respond to the confirmation request',
          notes:
            'Work completed and proof captured on site. The customer was called ' +
            'twice and sent the confirmation link again; no response within the ' +
            'window. Closing on the technician’s evidence.',
          attachments: [{ blobName: uploaded.photos, fileName: 'installed-unit.png' }],
          technicianPayoutPaise: payoutPaise ?? undefined,
        },
      });
      forced += 1;
      record('forceClosed');
      log(`    ${code}  force-closed (no feedback token on a remote run)`);
    }
    if (forced) {
      log(
        `\n    ⚠ ${forced} job(s) were force-closed rather than confirmed by the ` +
          `customer.\n      feedback_token is not exposed by the API, so a remote ` +
          `seed cannot reach it.\n      The customer-feedback page cannot be ` +
          `captured from this run.`,
      );
    }
  }

  // 7c — credits. A recharge is the only way the Credits screen has a payment
  //      to show, and the superadmin's confirmation is the only thing that adds
  //      credits — so both halves of that handshake are seeded.
  step('Credits');
  const platform = await call('/platform/settings', { token: superadmin });
  if (!platform.upiId) {
    // A recharge is refused with 409 RECHARGE_UNAVAILABLE until the platform
    // has somewhere to be paid. It belongs to no company, so it survives a
    // --reset and is only set when missing.
    await call('/platform/settings', {
      token: superadmin,
      method: 'PUT',
      body: {
        freeCredits: platform.freeCredits,
        ticketCredits: platform.ticketCredits,
        minusCreditLimit: platform.minusCreditLimit,
        minRechargeRupees: platform.minRechargeRupees,
        upiId: 'reliancegreentech@okhdfcbank',
        upiName: 'Reliance GreenTech Platform',
      },
    });
    log('    platform payee set');
  }

  const recharge = await call('/credits/recharges', {
    token: admin,
    method: 'POST',
    body: { amountRupees: 5000 },
  });
  const rechargeProof = await upload(admin, proofImages.barcode, 'upi-receipt.png', 'image/png', 'attachment');
  await call(`/credits/recharges/${recharge.id}/claim`, {
    token: admin,
    method: 'POST',
    body: {
      utr: '412783996201',
      proof: {
        blobName: rechargeProof.blobName ?? rechargeProof.name ?? rechargeProof.url,
        fileName: 'upi-receipt.png',
      },
    },
  });
  // Confirmed, so the balance moves and the statement has a recharge row in it.
  await call(`/platform/recharges/${recharge.id}/confirm`, {
    token: superadmin,
    method: 'POST',
  });
  const credits = await call('/credits', { token: admin });
  log(`    ${recharge.code ?? 'recharge'}  ₹5,000 confirmed · balance ${credits.balance}`);

  // 7d — a redemption, left UNPAID on purpose. `to_pay` is the state that draws
  //      the UPI QR on both sides; claiming it would replace the one screen
  //      worth photographing with a receipt.
  step('Redemption');
  const redeemer = await tokenFor(0);
  const redeemable = await call('/redemptions/me', { token: redeemer });
  if (redeemable.redeemablePaise > 0) {
    // The server recomputes the figure and 409s BALANCE_CHANGED on any
    // disagreement — the client never names its own price.
    const redemption = await call('/redemptions/me', {
      token: redeemer,
      method: 'POST',
      body: { amountPaise: redeemable.redeemablePaise },
    });
    log(`    ${redemption.code ?? 'redemption'}  ₹${(redeemable.redeemablePaise / 100).toFixed(0)} awaiting ${redeemable.payerLabel}`);
  } else {
    log('    nothing to redeem — no payout landed in the ledger');
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
    `DECK_VENDOR_USER_EMAIL=${VENDOR_SUBUSER.email}`,
    `DECK_VENDOR_USER_PASSWORD=${DEMO_PASSWORD}`,
    // The platform console (Companies, Geography) is a surface of its own, and
    // the capture had no way to reach it: `credentials('superadmin')` resolves
    // these names, but nothing ever wrote them.
    `DECK_SUPERADMIN_EMAIL=${SUPERADMIN.email}`,
    `DECK_SUPERADMIN_PASSWORD=${SUPERADMIN.password}`,
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
