# Synthetic data, load testing and device testing — locked decisions

Grilled 2026-09-15, **revised 2026-09-16** after the manager confirmed that NOTHING IS LIVE YET and
both environments may be tested. Demo on **2026-09-17**, delivered as a report and a live demo.

The three asks being answered:

1. Seed synthetic data — 500 tickets, 50 technicians across categories.
2. Write load tests and run them.
3. Run the app on several virtual devices while under load.

Each decision has the option chosen, why, what was rejected, the honest risk, and whether anything
**enforces** it. A rule marked *convention* has nothing stopping somebody breaking it — treat those
as the likeliest to go wrong.

> **The whole plan rests on one fact: nothing is live.** Every decision to touch production below is
> void the moment a real vendor, technician or customer exists. Re-read this file before repeating
> any of it.

---

## 1. The load test RAMPS UNTIL SOMETHING BREAKS

- **Chosen:** ramp until failure against production, and record the user count at which it starts,
  plus what fails first (API CPU, database connections, a specific endpoint). Dev keeps a cap of
  **150 users** for rehearsal runs.
- **Why:** capacity planning needs "it breaks at N, because X". Nothing is live, so production is
  allowed to fail.
- **Rejected (originally chosen 2026-09-15):** a hard 150-user cap, which only ever proved the
  system held to the ceiling.
- **Risk:** dev shares the Postgres server with production and will be slow or unusable during a
  production run. Anyone else working in dev has to be told.
- **Enforcement:** tooling — Locust stop conditions on the dev rehearsal; the production run is
  deliberately allowed to run to failure.

## 2. Load runs against the DEPLOYED Azure API and `RelianceProdDB`

- **Chosen:** target `installflowapi` (the deployed App Service) with the production database. One
  rehearsal run first against the **deployed DEV API**, `installflowapi-dev`
  (`https://installflowapi-dev-c2fqf7f4bjdbg8bz.centralindia-01.azurewebsites.net`, database
  `RelianceDB`), to shake out the scripts.
  ⚠ **Correction, 2026-09-16:** the plan of 2026-09-15 assumed no dev API was deployed, and so put
  the rehearsal on a laptop-hosted API. One exists — it is the `dev` target in
  [`publish.py`](../api/scripts/publish.py) — and it is alive (`/health` answers 200). Its
  `.env.dev-deploy` has `OTP_DEV_ECHO=true` and both allowlists set, which also makes it the right
  server for the emulators.
- **Why:** it measures the real infrastructure. A broken script must not waste a production run.
- **Rejected:** a local API against either database (the laptop would be the bottleneck).
- **Risk:** App Service may autoscale or throttle under a ramp, which changes what the breaking
  point means. Record the plan tier and instance count alongside the numbers.
- **Enforcement:** none — **convention**. The target is a URL in the Locust config.

## 3. The laptop only runs Locust

- **Chosen:** Locust on the laptop (i7-6600U, 2 cores / 4 threads, 16 GB) against the deployed API.
  Log laptop CPU throughout.
- **Why:** with the API on Azure, the laptop is only a load generator, so decision 3 of 2026-09-15
  ("measured on a laptop-hosted API") no longer applies and its caveat sentence is dropped.
- **Rejected:** a second machine (none available).
- **Risk:** a 2-core box can only generate so much load. **If laptop CPU saturates before the API
  does, the report must say the LOAD GENERATOR was the limit** — otherwise it claims a breaking
  point that belongs to the laptop.
- **Enforcement:** tooling — CPU sampling during the run.

## 4. 500 tickets across the whole lifecycle, in BOTH environments

- **Chosen:** the mix in `seed/lifecycle.py` → `MIX`: ~44% in the pool (with and without an agreed
  slot), ~26% held or being worked, ~24% settled (closed with payouts, or force-closed), ~6%
  accepted then cancelled late (penalty, and an escalation under four hours). One clearly named
  synthetic company; 50 technicians certified across the main sub-categories, their pincodes
  overlapping the tickets' so the pool is not empty. Seeded into dev first, then production.
  ⚠ **Correction, 2026-09-16:** "~10% cancelled" was not possible. **No code path writes
  `Cancelled`** (nor `AI Review`): a technician cancelling returns the job to the pool and is
  charged. That share is penalties and escalations instead, which is what the demo should show.
- **Why:** the demo must show Earnings, the penalty pool and the dashboard with real numbers, and
  the production load test needs realistic data volume.
- **Rejected:** 500 open tickets — quicker, half the app empty.
- **Risk:** roughly 3× the build effort, and production now carries data that must be removed.
  ⚠ **The pool decays.** The deployed API's sweeps keep running against the seeded tickets: an
  unaccepted job whose slot is under four hours away is escalated, and a slot that passes leaves
  the pool entirely. The dev run of 2026-09-16 had **31 of its tickets escalated by the sweep while
  it was still seeding.** So seed shortly before the load run and the demo — not the day before —
  or the pool the load test reads will be thin.
- **Enforcement:** tooling — the seed script, run twice with a different target database.
- **Result, dev, 2026-09-16** (`--tag LOADTEST`, company `540a0f74-fabf-461b-b119-5f10d32e814d`,
  1,206 s): 500 tickets — Slot Pending 120, Closed 97, New 75, Assigned 70, Escalated 61,
  In Progress 30, Awaiting Customer 29, Force-Closed 18. 115 payouts (₹67,250), 30 penalties
  (₹23,100). Six planned transitions were refused by the product itself — technicians at their
  daily cap — and left in the pool. All checks passed; `audit_tenancy` clean.

## 5. History is built through the real services, then backdated

- **Chosen:** walk every ticket through the real service functions with FUTURE slots, then shift its
  timestamps into the past. Credits are recharged first (500 × 10 would otherwise hit
  `OUT_OF_CREDITS` near ticket 150). **No images are uploaded at all:** the proof check only
  inspects a blob name's prefix, so the seed names blobs that do not exist rather than leaving
  files in a container both environments share. Proof thumbnails will not render for seeded jobs.
  Emails go to `@seed.example.com` (RFC 2606, IANA-held) — `.invalid` was tried and is refused by
  `email_validator` before any request model accepts it.
- **Why:** prices, `rules_snapshot`, penalties and payouts all come from the real code, so no two
  screens can disagree.
- **Rejected:** writing events, proofs and ledger rows in SQL (one missed ledger row puts a wrong
  number in the demo); an overridable clock in production code (changes the product for test data).
- **Risk:** the shift must reach EVERY time column, or a ticket's history contradicts its status.
  Blob storage is shared by both environments and `cleanup_db` never deletes blobs — hence reused
  images, and hence images survive the production cleanup.
- **Enforcement:** tooling — the seed ends with a check that fails loudly unless:
  - each technician's earnings equal payouts + bonuses − penalties from their own ledger rows;
  - no technician passes the monthly penalty cap;
  - every ticket's events are in time order and end in its current status;
  - `python -m app.scripts.audit_tenancy` passes.

## 6. Synthetic numbers are UNREACHABLE; production's allowlists stay empty

- **Chosen:** every synthetic technician and customer gets a number matching `^\+911\d{9}$`
  (`+911000000001`, …). Indian mobile numbers only begin 6, 7, 8 or 9, so these are valid in shape
  ([`phone.py`](../api/app/core/phone.py) accepts them) but can never belong to a subscriber —
  a WhatsApp send to one fails at Meta and reaches nobody. Production's `WHATSAPP_ALLOWLIST` and
  `ACS_EMAIL_ALLOWLIST` stay **empty**, exactly as production expects.
  Four real team numbers are the sole exception, carried by four seeded technicians so real
  sign-in can be tested: `+916301815418`, `+919398475448`, `+919951753840`, `+919390643013`.
- **Why:** the deployed app's seven background sweeps ([`main.py`](../api/app/main.py)) would
  otherwise message 500 invented customers on their own schedule — unsolicited messages to real
  people, and a template quality rating Meta can restrict the business number over, before launch.
- **Rejected:**
  - **An allowlist muzzle on production.** It was the first choice, and `publish.py` refuses it
    outright ([`publish.py`](../api/scripts/publish.py) — "must be empty in production — anything
    else silently drops messages to everyone not named in it"). The guard is right: an allowlist
    left set at launch means real users never receive anything. Weakening it was rejected.
  - **Azure App Settings** (environment variables outrank `.env`): needs Portal access, which
    nobody on this side has. `az` is signed in without ARM rights.
  - **Clearing `WHATSAPP_TOKEN`:** no message flow testable at all, including OTP sign-in.
- **Risk:** a typo could put a real number in the seed. Unlike the allowlist approach, this leaves
  **nothing to undo at launch**, which is its main advantage.
- **Enforcement:** tooling — the seed refuses to run if any generated number fails `^\+911\d{9}$`,
  the four real numbers excepted.

## 7. Sign-in never goes through OTP at scale

- **Chosen:** a script mints sessions directly with `issue_session()`
  ([`auth/service.py`](../api/app/features/auth/service.py)) for all 50 technicians. Load test and
  browser sessions use those tokens; the browser build keeps its session in `localStorage`, so a
  token can be written straight in.
- **Why:** OTP is throttled per phone and per IP, production refuses to run with dev echo on
  (`OTP_DEV_ECHO=false`), and codes are stored hashed with a server-side pepper, so no code can be
  read out of the database.
- **Rejected:** a dev-echo bypass on production (the API refuses to boot with it); 50 real phone
  numbers (impossible).
- **Risk:** the script mints real sessions. It belongs with the seed, gated by the same
  environment checks, and the tokens must not be committed.
- **Enforcement:** tooling — the minting script.

## 8. Two emulators sign in with REAL WhatsApp codes

- **Chosen:** the team's real numbers are seeded technicians `…-TCH-0001` to `…-TCH-0004`, and the
  emulators sign in as them with a genuine WhatsApp code:
  - **production** — all four receive one (allowlists empty, approved `yar_otp` template);
  - **dev** — only `+916301815418` and `+919398475448`, the two in `.env.dev-deploy`'s allowlist.
  Emulators are configured at 4 cores / 3 GB; **run one at a time, two at most**, since the host has
  2 physical cores. Optionally, 5–10 browser sessions with injected tokens (decision 7) act as
  extra technicians.
- **Why:** it proves the real sign-in path on real infrastructure, and the devices show what a
  technician experiences while the system is under load.
- **Rejected:**
  - 5–10 emulators — the host cannot run them, and they add almost nothing to the load.
  - **Putting the dev OTP panel back on the login screen** (decided 2026-09-15, reversed
    2026-09-16). It was removed deliberately in `36a9ed1`: *"a scaffold left standing is one config
    flag away from showing a real technician their own OTP."* That outweighs the convenience, and
    the real numbers above make it unnecessary.
- **Risk:** each emulator competes with Locust for the laptop's 2 cores; watch CPU. Only two
  technicians can be signed into on dev.
- **Enforcement:** none needed — no code change. **The device count is convention.**

## 9. The demo is 2026-09-17

Unchanged. The manager has been told.

---

## Findings

### F1 — the first limit is Postgres connection slots (dev rehearsal, 2026-09-16)

Run 2 (`results/dev-rehearsal-2*`) reached 125 users: 10,847 requests, 60 failures (0.55%),
p50 64 ms, p95 240 ms, p99 1,000 ms. The failures were 500s and 502s in three ~2-second bursts
(10:38:05, 10:41:09, 10:44:15 UTC), the first at ~90 users / ~12 rps, recovering at once each time.

Right after the run the server refused new connections — `FATAL: remaining connection slots are
reserved for roles with the SUPERUSER attribute`. What the server showed once a slot was free:

- `max_connections = 50`, `superuser_reserved_connections = 10` → **40 usable, for everybody**.
- **The server is shared beyond this product:** `ai360crmdb`, `cdealDev`, `whatsappwebhookdb` and
  Azure's own databases hold connections on it too. A load test here is felt by other teams' apps.
- The dev API held 12 connections, several **opened at exactly the burst times** — connections
  being replaced, which is what a restarted worker or an exhausted pool looks like.
- The API sets no pool size (`app/core/database.py`), so each gunicorn worker may hold 5 and burst
  to 15. Two workers × two apps = up to 60 on a server with 40 slots, before pgAdmin, the realtime
  listeners and the other teams.

More, from `pg_stat_activity` the same afternoon:

- **Dev, production, `cdealDev` and `whatsappwebhookdb` all connect from one address**
  (`20.244.59.254`) — almost certainly one App Service plan. A load test on dev competes with
  production for CPU and memory too, not only for database slots.
- **Every app uses the same role, `appuser`.** Nothing on the server can tell them apart or cap
  one without capping all.
- The dev workers' LISTEN connections dated from before run 2, so **the workers did not restart**
  during the bursts: the connections opened then were the pool growing or replacing connections.

Action taken: the API's pool is now sized explicitly (`DB_POOL_SIZE` 3, `DB_MAX_OVERFLOW` 2,
`DB_POOL_TIMEOUT` 10 s, `DB_POOL_RECYCLE` 1500 s — `app/core/config.py`), not yet deployed. The
12 idle pool connections the two sites held (10 dev, 2 production) were ended with
`pg_terminate_backend`; the four LISTEN sessions were left alone, and both sites answered normally
afterwards (`pool_pre_ping` replaces an ended connection on its next checkout).

Not yet proven: WHY the bursts were periodic (~185 s). That needs the App Service logs, which need
the dev publish profile, which is not on the test laptop.

## Order of work

1. Seed script + session-minting script + the check step. *(Done.)*
2. ~~Login-screen `devCode`~~ — dropped, decision 8.
3. Locust scenarios — pool polling, the first-accept-wins race (exactly one winner), vendor intake,
   the console dashboard and escalation queue. No proof uploads under load (shared blob storage).
4. Seed dev → rehearsal run against the deployed dev API, capped at 150. *(Dev seeded 2026-09-16.)*
5. Seed production (~20 minutes) **immediately before** its ramp-to-failure run against the deployed
   API, with 2 emulators in use — the pool decays under the sweeps (decision 4). No deploy and no
   config change is needed (decision 6).
6. Report and demo script.

## Go-live checklist — production must be cleaned BEFORE any real user exists

Owner: Harika. Date: **not yet set.**

- [ ] Delete the synthetic company from production:
      `$env:POSTGRES_DB='RelianceProdDB'; python -m app.scripts.cleanup_db --keep <every real company id>`
      (it takes a `pg_dump` first, and refuses an empty keep list on production).
- [ ] Confirm `WHATSAPP_ALLOWLIST` and `ACS_EMAIL_ALLOWLIST` are still EMPTY in `.env.production`
      (decision 6 means they were never set; `publish.py` refuses a deploy if they are).
- [ ] Nothing to remove from blob storage: the seed uploads no files (decision 5).
- [ ] Re-read this file's opening warning before ever repeating a production test.
