/**
 * Virtual technician devices: the app's web build in phone-sized browsers,
 * each signed in as a different seeded technician, used while Locust runs.
 *
 *   node devices.mjs --db RelianceDB --web <dir of `expo export --platform web`> \
 *        --count 8 --minutes 16 --run <run-id> [--headless]
 *
 * Why the web build: the laptop can hold two Android emulators at most
 * (DECISIONS.md, decision 8), and the native app keeps its session in the
 * Keystore, which nothing outside the app can write. The web build keeps it in
 * localStorage, so a minted session can be put straight in — no OTP.
 *
 * Sessions are TAKEN out of `.sessions/<db>.json` (and kept in
 * `.sessions/<db>-devices.json`) so no Locust user holds the same refresh token:
 * tokens rotate, and two holders sign each other out.
 *
 * Writes, in results/:
 *   <run>-devices.csv        one row per screen visit: device, screen, ms, calls, errors
 *   <run>-devices-api.csv    every API call the pages made, as the browser timed it
 *   <run>-devices/           a screenshot per device per round
 *
 * Playwright comes from the global install (`npm i -g playwright`), because
 * the loadtest folder deliberately has no node_modules of its own.
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium, devices } = require(path.join(globalRoot, 'playwright'));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      const next = all[i + 1];
      acc.push([a.slice(2), next && !next.startsWith('--') ? next : true]);
    }
    return acc;
  }, []),
);

const DB = args.db ?? 'RelianceDB';
const WEB_ROOT = path.resolve(args.web);
const COUNT = Number(args.count ?? 8);
const MINUTES = Number(args.minutes ?? 16);
const RUN = args.run ?? `devices-${Date.now()}`;
const PORT = Number(args.port ?? 5173); // one of the origins the API's CORS allows
const ORIGIN = `http://localhost:${PORT}`;

const RESULTS = path.join(HERE, 'results');
const SHOTS = path.join(RESULTS, `${RUN}-devices`);
fs.mkdirSync(SHOTS, { recursive: true });

// The API base is baked into the bundle at export time — read it back so the
// sessions are refreshed against the same server the pages will call.
const API = (() => {
  const dir = path.join(WEB_ROOT, '_expo', 'static', 'js', 'web');
  for (const f of fs.readdirSync(dir)) {
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/https:\/\/installflowapi[^"'\s]*?\/api\/v1/);
    if (m) return m[0];
  }
  throw new Error('No API base URL found in the web bundle');
})();

const PROFILES = ['Pixel 7', 'Galaxy S9+', 'Pixel 5', 'Galaxy S8', 'Moto G4', 'Nexus 5', 'iPhone 13', 'iPhone SE'];

// ── static server with SPA fallback ──────────────────────────────────────────

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(WEB_ROOT, url);
  if (!file.startsWith(WEB_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(WEB_ROOT, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(PORT, ok));

// ── sessions ─────────────────────────────────────────────────────────────────

const sessionsFile = path.join(HERE, '.sessions', `${DB}.json`);
const devicesFile = path.join(HERE, '.sessions', `${DB}-devices.json`);
const bundle = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));

// One session per DIFFERENT technician, taken from the end of the list.
const taken = [];
const seen = new Set();
for (let i = bundle.technicians.length - 1; i >= 0 && taken.length < COUNT; i--) {
  const s = bundle.technicians[i];
  if (seen.has(s.code)) continue;
  seen.add(s.code);
  taken.push(...bundle.technicians.splice(i, 1));
}
fs.writeFileSync(sessionsFile, JSON.stringify(bundle, null, 2));

async function api(method, p, token, body) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${json.message ?? ''}`);
  return json.data;
}

const signedIn = [];
for (const s of taken) {
  const t = await api('POST', '/auth/refresh', null, { refreshToken: s.refreshToken });
  const technician = await api('GET', '/technicians/me', t.accessToken);
  signedIn.push({ code: s.code, accessToken: t.accessToken, refreshToken: t.refreshToken, technician });
}
fs.writeFileSync(devicesFile, JSON.stringify(signedIn.map(({ code, accessToken, refreshToken }) => ({ code, accessToken, refreshToken })), null, 2));

// ── measurement ──────────────────────────────────────────────────────────────

const screensCsv = fs.createWriteStream(path.join(RESULTS, `${RUN}-devices.csv`));
screensCsv.write('utc,device,profile,technician,round,screen,ms,api_calls,api_errors,note\n');
const apiCsv = fs.createWriteStream(path.join(RESULTS, `${RUN}-devices-api.csv`));
apiCsv.write('utc,device,method,endpoint,status,ms\n');

const endpoint = (u) =>
  new URL(u).pathname.replace(/^\/api\/v1/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');

const deadline = Date.now() + MINUTES * 60_000;
const browser = await chromium.launch({ headless: Boolean(args.headless) });

async function runDevice(index, who) {
  const profileName = PROFILES[index % PROFILES.length];
  const { defaultBrowserType, ...profile } = devices[profileName];
  const context = await browser.newContext(profile);
  const name = `D${index + 1}`;

  // Only on first load: afterwards the app rotates its own tokens and a reload
  // must not put the revoked ones back.
  await context.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  }, {
    key: 'reliancegreentech.session',
    value: JSON.stringify({
      state: { accessToken: who.accessToken, refreshToken: who.refreshToken, technician: who.technician },
      version: 1,
    }),
  });

  const page = await context.newPage();
  let pending = 0;
  let lastActivity = Date.now();
  let calls = 0;
  let errors = 0;
  let poolIds = [];

  page.on('request', (req) => {
    if (req.url().startsWith(API)) { pending++; lastActivity = Date.now(); }
  });
  const done = async (req, status) => {
    if (!req.url().startsWith(API)) return;
    pending = Math.max(0, pending - 1);
    lastActivity = Date.now();
    calls++;
    // 409 is the product answering (first-accept-wins), not a failure.
    if (status === 0 || (status >= 400 && status !== 409 && status !== 401)) errors++;
    const t = req.timing();
    // `responseEnd` is already relative to the request's start.
    const ms = t.responseEnd >= 0 ? Math.round(t.responseEnd) : '';
    apiCsv.write(`${new Date().toISOString()},${name},${req.method()},${endpoint(req.url())},${status},${ms}\n`);
  };
  page.on('requestfinished', async (req) => {
    const res = await req.response().catch(() => null);
    if (res && req.url().startsWith(API) && /\/jobs\/pool\b/.test(req.url())) {
      try { poolIds = ((await res.json()).data ?? []).map((j) => j.id); } catch { /* not json */ }
    }
    done(req, res ? res.status() : 0);
  });
  page.on('requestfailed', (req) => done(req, 0));

  /** Wait until the page has made its calls and none is in flight for 400 ms. */
  // The time is when the LAST call answered — what the person waits for. A
  // screen that makes no call within `firstCallMs` is served from cache: 0.
  async function settle(startedAt, firstCallMs, timeoutMs = 30_000) {
    while (Date.now() - startedAt < timeoutMs) {
      await page.waitForTimeout(100);
      const quiet = pending === 0 && Date.now() - lastActivity > 400;
      if (calls === 0 && pending === 0) {
        if (Date.now() - startedAt > firstCallMs) return 0;
        continue;
      }
      if (quiet) return Math.max(0, lastActivity - startedAt);
    }
    return null;
  }

  async function visit(round, screen, go) {
    calls = 0; errors = 0;
    const started = Date.now();
    let note = '';
    try { await go(); } catch (e) { note = String(e.message).split('\n')[0].replace(/,/g, ';'); }
    const ms = await settle(started, screen === 'cold start' ? 8000 : 1200);
    if (ms === null) note = note || 'timeout';
    screensCsv.write(`${new Date().toISOString()},${name},${profileName},${who.code},${round},${screen},${ms ?? ''},${calls},${errors},${note}\n`);
  }

  // In-app navigation, like a tap: no reload, the router handles the URL.
  const nav = (p) => page.evaluate((to) => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, p);

  await visit(0, 'cold start', () => page.goto(ORIGIN + '/', { waitUntil: 'load' }));

  for (let round = 1; Date.now() < deadline; round++) {
    await visit(round, 'home', () => nav('/'));
    await page.waitForTimeout(2000 + Math.random() * 2000);
    await visit(round, 'pool', () => nav('/pool'));
    await page.waitForTimeout(1500);
    if (poolIds.length) {
      const id = poolIds[Math.floor(Math.random() * poolIds.length)];
      await visit(round, 'offer', () => nav(`/pool/${id}`));
      await page.waitForTimeout(1500);
    }
    await visit(round, 'jobs', () => nav('/jobs'));
    await page.waitForTimeout(1500);
    await visit(round, 'earnings', () => nav('/earnings'));
    await page.waitForTimeout(1500);
    await visit(round, 'profile', () => nav('/profile'));
    if (round % 3 === 1) {
      await page.screenshot({ path: path.join(SHOTS, `${name}-round${String(round).padStart(2, '0')}.png`) }).catch(() => {});
    }
    await page.waitForTimeout(3000 + Math.random() * 3000);
  }

  // Keep the rotated tokens for the next run.
  const stored = await page.evaluate(() => localStorage.getItem('reliancegreentech.session')).catch(() => null);
  await context.close();
  if (stored) {
    const s = JSON.parse(stored).state;
    return { code: who.code, accessToken: s.accessToken, refreshToken: s.refreshToken };
  }
  return { code: who.code, accessToken: who.accessToken, refreshToken: who.refreshToken };
}

console.log(`${signedIn.length} devices against ${API} for ${MINUTES} min → results/${RUN}-devices*.csv`);
const finalTokens = await Promise.all(
  signedIn.map((who, i) => new Promise((r) => setTimeout(r, i * 1500)).then(() => runDevice(i, who))),
);
fs.writeFileSync(devicesFile, JSON.stringify(finalTokens, null, 2));
await browser.close();
screensCsv.end();
apiCsv.end();
server.close();
console.log('devices done');
