# Task 16 — Rollout, seeds, scripts and the AGENTS.md updates

> Layer: **all**. Depends on **every task 00–15**. Read [00-index.md](00-index.md) first; it wins over this
> document on any name. This task writes **no feature code**. It (a) fixes the order in which the fifteen
> other tasks reach production, (b) collects every change they make to the seed, verify, cleanup and audit
> scripts, checked against the code on `dev @ 6763026`, (c) drafts the prose the three AGENTS.md files and
> the mobile skill must gain, and (d) defines the end-to-end smoke that says the programme is done.
> Where this document chooses something no other document settles, it says **Decision (writer)**.

---

## 1. Goal & why

**Plain version.** Fifteen tasks change one database, one API, one console and one Android app. They cannot
all ship at once, and they cannot ship in any order: some migrations make the *old* API fail the moment they
run, some API changes crash the *old* app, and one console change lets a person sign in to a screen that is
not built yet. This task is the timetable that avoids all three, plus the housekeeping that makes the work
reproducible: the seed scripts that build demo data, the checks that prove the data adds up, the cleanup
script that must know every table, and the written rules the next developer reads first.

**Worked example — what goes wrong without the timetable.**

1. The owner migrates production to `3b7e1f0a9c41` on Monday and plans to publish the API on Tuesday. All of
   Monday night, every customer who taps "Yes, it's done" gets an error, because the deployed API inserts a
   `payout` row with no `franchisee_id` and the column is now NOT NULL (Task 01 §8). → **R1 publishes in the
   same sitting as the migration.**
2. Task 10 is published the week Task 07 reached Play. Ravi has not updated. He closes a job 27 km from home,
   the API writes a `travel` row, and his app closes itself every time he opens Earnings (Task 07 §1). →
   **R5 waits until ≥ 90 % of active devices run Task 07's build.**
3. Task 08 reaches the production console without Task 09. An Admin creates SkyFix's franchisee admin, Anil
   signs in, and lands in the staff shell where every list is empty or 403 (Task 08 §8 trap 1). →
   **08 and 09 deploy together.**

**Done means:** every release R0–R10 below is live on production, the §7 smoke passes on dev, the scripts in §5
are green on dev, and the prose in §6 is in the repository.

---

## 2. Decisions

From the index (binding): **release gates (a), (b), (b2), (c), (d), (e)** in §4, the **X4 nuance** in §6a
(Task 07 on Play's production track **and** ≥ 90 % of active technicians on that build before Tasks 10/11
publish), **X5** (prod migrated by the owner before the API that needs it), **X1** (no database tests;
`verify.py` and acceptance criteria prove database behaviour), **X2** (copy signed off before a client task is
built), **X3** (`react-native-webview` is the only native module).

Judgement calls made here:

| # | Decision (writer) | Why |
|---|---|---|
| W1 | **Eleven releases, R0–R10** (§4). API releases are kept small so each migration has one owner sitting and one rollback story; client releases ride beside the API release that makes them safe. Tasks 10, 11 and 12 may be merged into one sitting if the owner prefers — every gate that applies to one applies to all three. | A failed release then names one task. |
| W2 | **Task 04 rides in R1** with 01–03, not alone later. | A carve-out (Task 03) re-stamps tickets; without Task 04 nothing reads the stamp, so a franchisee could exist on prod whose tickets every technician is still offered. If 04 is not ready, R1 ships 01–03 and **no non-home franchisee may be created on prod** until 04 is published. |
| W3 | **Task 05 and Task 06 publish together** (R2), as both their docs require (05 §8 trap 1, 06 §8 trap 1). | Between them an employee is paid per job and that money is later dropped from the redeemable balance. |
| W4 | **The owner migrates production to an explicit revision**, never `head`: `alembic upgrade 5d2a8c6e0b13`, not `upgrade head`. | `main` may carry a later migration than the release needs; naming the revision makes the sitting do exactly what the gate allowed. |
| W5 | **`main` carries one release at a time.** Each release is merged from `dev` to `main` at a tagged commit (`franchise-R1` …). Until R4's gate is met, `main` must not contain Task 10–12 code, and any production hotfix in that window is cut from the last release tag, not from `dev`. | `prod-deploy.yml` and `web-prod-deploy.yml` deploy whatever `main` holds; `dev` accumulates every task as it lands. |
| W6 | **Task 07's build is submitted as soon as it is ready** — it needs Task 06 only on dev, not on prod (Task 07 §7.12: the new build is identical to the old against today's API). R4 therefore overlaps R2/R3. | The adoption wait is the longest lead time in the programme. |
| W7 | **Console forward-compatibility ships in R4**, split out of Task 13: §5.1 (ledger kinds) and the status half of §5.2 (`Awaiting Part` badge, filter, dashboard set). Index §6a allows the split. | Gate (e) and Task 13 §8: both must be on **both** console deploys before Tasks 11 and 12 publish; R4 is the earliest window with nothing else to wait for. |
| W8 | **No employee on production until R4's adoption gate is met.** Nobody sets `technicianType = employee` on prod before then (soft gate, by agreement). | An old build shows an employee a payout figure and a Redeem button that ends in an English 409 (Task 07 §7.12 matrix). Harmless, but avoidable. |
| W9 | **`seed_play_review` is re-run on production before every Play submission** — R4 (Task 07), R5 (Task 14), R8 (Task 15) — and its reviewer stays a **home-franchisee freelancer** (§5.4). The owner runs it (`--production`). | api/AGENTS.md "Google Play review sign-in"; memory: re-seed before each submission. |
| W10 | **Prose lands with the release that makes it true.** §6 is the full text; each block names the release it belongs to. A final pass after R8 reconciles them. Tasks 05/06 already ask for their api/AGENTS.md edits "in the same commit" — those blocks are the ones in §6.2 tagged R2. | AGENTS.md describes what is live; a paragraph about speed allowance on the day only franchisees exist is a rule nobody can follow. |
| W11 | **The seeds exercise every new feature** (§5.1), so each `verify.py` check compares two paths over real rows instead of passing on an empty set. | `verify.py`'s own docstring: "A check that merely re-reads what the seed wrote would pass on broken data" — and one that reads no rows passes on anything. |

---

## 3. Schema — the migration chain, dev → prod

No migration is authored here. This is the order, what each needs, and the read-only check for each.

### 3.1 The chain

| # | Revision | File | `down_revision` | Task | Release |
|---|---|---|---|---|---|
| 0 | `f9c2d8a3e17b` | owner's branch — pincodes get `latitude`/`longitude` | expected `ea2fb2654b95` (today's repo head, *a technician can pass a job offer*) | 00 | R0 |
| 1 | `3b7e1f0a9c41` | `3b7e1f0a9c41_every_company_has_franchisees.py` | `f9c2d8a3e17b` | 01 | R1 |
| 2 | `5d2a8c6e0b13` | `5d2a8c6e0b13_franchise_roles_and_features.py` | `3b7e1f0a9c41` | 02 | R1 |
| 3 | `7c4f2e9a1d58` | `7c4f2e9a1d58_franchisee_admins_review_and_are_notified.py` | `5d2a8c6e0b13` | 05 | R2 |
| 4 | `9e1b5d3c7a26` | `9e1b5d3c7a26_travel_allowance.py` | `7c4f2e9a1d58` | 10 | R5 |
| 5 | `b4a8e2f6c903` | `b4a8e2f6c903_speed_allowance.py` | `9e1b5d3c7a26` | 11 | R6 |
| 6 | `d6c3a9f1e874` | `d6c3a9f1e874_spare_parts.py` | `b4a8e2f6c903` | 12 | R7 |

Tasks 03, 04, 06, 07, 08, 09, 13, 14, 15 have no migration. If a task lands out of order, its implementer
re-points `down_revision` and says so in the commit (index §3.6); this table is then corrected in the same PR.

### 3.2 What each needs before it runs

| Revision | Needs | Pre-flight (read-only) |
|---|---|---|
| `f9c2d8a3e17b` | `ea2fb2654b95` on the target. Its file's `down_revision` must be a revision in this repo — if it names `b8e3f14a9c27` instead, the chain has **forked** at the job-pass migration; stop and ask the owner (Task 00 §3.1), never write a merge migration on a guess. On prod: the **coordinate data**, not just the columns (G1) — whatever loaded them on dev must run on prod too. | `SELECT version_num FROM alembic_version;` → `ea2fb2654b95`. `python -m alembic heads` (repo) → one head. |
| `3b7e1f0a9c41` | `f9c2d8a3e17b`. The two CHECKs it rewrites are named `ck_ticket_events_kind` and `ck_notifications_kind` (01 §3.3a). **The API that writes the five NOT NULL columns** (Tasks 01–03) must be published in the same sitting (gate b2). | `SELECT conname FROM pg_constraint WHERE conname IN ('ck_ticket_events_kind','ck_notifications_kind');` → 2 rows. Task 01 §7.1 fingerprint, saved. |
| `5d2a8c6e0b13` | `3b7e1f0a9c41`. `roles`, `features`, `role_feature_defaults` rows it inserts are idempotent. | `SELECT key FROM roles WHERE rank >= 8;` → 0 rows. |
| `7c4f2e9a1d58` | `5d2a8c6e0b13`, and `uq_franchisees_company_id_id` (01) as its FK target. It adds `ledger_entries.technician_type` **NOT NULL with no default**, so the R1 API cannot write a ledger row against it — **publish R2 in the same sitting** (§4, R2). | `SELECT count(*) FROM ledger_entries l LEFT JOIN technician_profiles p ON p.company_id = l.company_id AND p.id = l.technician_id WHERE p.id IS NULL;` → 0 (the backfill reads the profile). |
| `9e1b5d3c7a26` | `7c4f2e9a1d58`. The ledger CHECK at `kind IN ('penalty','bonus','payout','reversal')` (the helper matches on `'penalty'`). Behaviourally — not for the DDL — `f9c2d8a3e17b`'s **data** on the target. **Gate (a)/X4 met.** | `SELECT count(*), count(latitude) FROM pincodes;` → 19496 / ≈ 19195. `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_ledger_entries_kind';` |
| `b4a8e2f6c903` | `9e1b5d3c7a26` (`accept_snapshot`, `'travel'` in the kind CHECK). Its `_EVENTS` list must equal the live `ck_ticket_events_kind` (with `franchisee_changed`). **Gate (a)/X4 and gate (e) met.** | `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_ticket_events_kind';` — compare with the file. |
| `d6c3a9f1e874` | `b4a8e2f6c903`. Its `_EVENTS_BEFORE` includes **`'speed_settled'`** (reconciled in Task 12 §3.3); its own `_assert_check_is` still stops the upgrade if the live CHECK differs. `_AUDIENCES_BEFORE` includes `franchisee_admin` (05), `_NOTIFICATIONS_BEFORE` includes `technician_moved` (01). **Gate (a) and Task 13 §5.2 on both consoles.** | Same constraint query for `ck_tickets_status`, `ck_ticket_events_kind`, `ck_notifications_kind`, `ck_notifications_audience`. |

### 3.3 The owner's command — production, one revision at a time

Run from `api/`, PowerShell. `api/alembic/env.py` refuses `RelianceProdDB` without `CONFIRM_PROD` (root
AGENTS.md's one-liner predates that guard — §6.1 corrects it):

```powershell
$env:CONFIRM_PROD='yes-i-mean-it'; $env:POSTGRES_DB='RelianceProdDB'
./.venv/Scripts/python.exe -m alembic current                 # expect the PREVIOUS row of §3.1
./.venv/Scripts/python.exe -m alembic upgrade <revision>      # the release's revision, never "head"
./.venv/Scripts/python.exe -m alembic current
Remove-Item Env:CONFIRM_PROD, Env:POSTGRES_DB
```

Then publish the API (`prod-deploy.yml` on `main`, or `scripts/publish.py --target prod`). On dev the same
revisions are applied by the implementer, round-trip tested (`upgrade` → `downgrade <previous>` → `upgrade`,
ids compared, api hard rule 6) **before** the PR is merged — `dev-deploy.yml` deploys `installflowapi-dev` on
every push to `dev`, and if that app's startup command migrates (§8 trap 1), the push migrates RelianceDB too.

### 3.4 Read-only verification per migration

The agent offers to run these against production **inside `BEGIN READ ONLY; … ROLLBACK;`** after the owner's
sitting (memory: the owner runs prod migrations; we verify). Every one is also run on dev.

**`f9c2d8a3e17b`**
```sql
SELECT version_num FROM alembic_version;                                         -- f9c2d8a3e17b
SELECT data_type, is_nullable FROM information_schema.columns
 WHERE table_name = 'pincodes' AND column_name IN ('latitude','longitude');      -- 2 rows, nullable
SELECT count(*) AS total, count(latitude) AS with_point FROM pincodes;           -- 19496 / ≈ 19195
```

**`3b7e1f0a9c41`**
```sql
SELECT c.id FROM companies c LEFT JOIN franchisees f ON f.company_id = c.id AND f.is_home AND f.deleted_at IS NULL
 GROUP BY c.id HAVING count(f.id) <> 1;                                          -- 0 rows
SELECT count(*) FROM franchisees WHERE NOT is_home;                              -- 0 on the day
SELECT count(*) FROM franchisee_pincodes;                                        -- 0 on the day
SELECT 'tp', count(*) FROM technician_profiles WHERE franchisee_id IS NULL
UNION ALL SELECT 'ti', count(*) FROM technician_invites WHERE franchisee_id IS NULL
UNION ALL SELECT 't',  count(*) FROM tickets WHERE franchisee_id IS NULL
UNION ALL SELECT 'le', count(*) FROM ledger_entries WHERE franchisee_id IS NULL
UNION ALL SELECT 'r',  count(*) FROM redemptions WHERE franchisee_id IS NULL;    -- five zeros
SELECT technician_type, count(*) FROM technician_profiles GROUP BY 1;            -- only freelancer
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname IN ('ck_ticket_events_kind','ck_notifications_kind');             -- franchisee_changed / technician_moved present
-- plus Task 01 §7.1's fingerprint: identical counts and md5s to the one saved in pre-flight
```

**`5d2a8c6e0b13`**
```sql
SELECT key, label, rank FROM roles WHERE rank >= 8 ORDER BY rank;                -- franchisee_admin 8, facility_admin 9, facility_operator 10
SELECT f.key, string_agg(d.role, ',' ORDER BY d.role) FROM features f
  JOIN role_feature_defaults d ON d.feature_id = f.id AND d.enabled
 WHERE f.key LIKE 'franchise%' OR f.key LIKE 'parts.%' GROUP BY f.key ORDER BY f.key;   -- exactly index §3.4
```

**`7c4f2e9a1d58`**
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname IN ('ck_notifications_audience','ck_notifications_franchisee_audience',
                   'ck_upi_change_requests_reviewer_role','ck_ledger_entries_technician_type');  -- 4 rows
SELECT count(*) FROM ledger_entries WHERE technician_type IS NULL;               -- 0
SELECT technician_type, count(*) FROM ledger_entries GROUP BY 1;                 -- only freelancer on the day
```

**`9e1b5d3c7a26`**
```sql
SELECT f.id FROM franchisees f LEFT JOIN franchisee_travel_rules r
  ON r.company_id = f.company_id AND r.franchisee_id = f.id
 GROUP BY f.id HAVING count(r.id) <> 2;                                          -- 0 rows
SELECT count(*) FROM franchisee_travel_rules WHERE paise_per_step <> 0 OR max_paise_per_job <> 0;  -- 0 on the day (TA4: off)
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_ledger_entries_kind';      -- includes 'travel'
SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_ledger_entries_one_travel';                  -- partial on kind = 'travel'
SELECT count(*) FROM tickets WHERE accept_snapshot IS NOT NULL;                  -- 0 on the day
SELECT jsonb_typeof(accept_snapshot), count(*) FROM tickets GROUP BY 1;          -- never 'null' (JSON null ≠ SQL NULL, Task 10 §8 trap 1)
```

**`b4a8e2f6c903`**
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_ledger_entries_kind';      -- + speed_reward, speed_penalty
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_ticket_events_kind';       -- + speed_settled, still franchisee_changed
SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_ledger_entries_speed_once';
SELECT count(*) FROM franchisee_speed_rules;                                     -- 0 on the day (W1 of Task 11: empty = off)
```

**`d6c3a9f1e874`**
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname IN ('ck_tickets_status','ck_ticket_events_kind','ck_notifications_kind','ck_notifications_audience');
  -- 'Awaiting Part'; the five part_* kinds AND speed_settled AND franchisee_changed; part_requested/part_decided/part_issued; facility
SELECT count(*) FROM spare_parts; SELECT count(*) FROM spare_part_requests;      -- 0, 0 on the day
SELECT indexname FROM pg_indexes WHERE indexname IN
 ('uq_spare_parts_node_name','uq_spare_parts_model_name','uq_spare_part_requests_open_name');      -- 3 rows
```

**After every migration**, both databases:
```sql
-- api/AGENTS.md hard rule 6 — every FK has a covering index: 0 rows
SELECT c.conrelid::regclass, c.conname FROM pg_constraint c
WHERE c.contype = 'f' AND NOT EXISTS (
  SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
    AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey);
```
and `python -m app.scripts.audit_tenancy` (exit 0; `$env:POSTGRES_DB='RelianceProdDB'` for prod — it only reads).

---

## 4. Release plan

Each release lists: tasks · the gate that must be true before it starts · prod migration (owner, first) ·
API publish · adminWeb deploy · mobile build and Play track · after-checks. "Console deploy" means
`web-prod-deploy.yml` on `main` → `installflowweb`; dev follows automatically on push to `dev`.

```
R0 prerequisites ─► R1 01·02·03·04 (API) ─► R2 05·06 (API) ─► R3 08·09 (console)
                         │
                         └──── R4 07 on Play + console forward-compat ──(≥90 % adoption)──┐
                                                                                         ▼
                   R5 10 (API) + 13-travel (console) + 14 (Play) ─► R6 11 (API) + 13-speed
                   ─► R7 12 (API) + 13-parts (console) ─► R8 15 (Play) ─► docs final pass
                   ─► R9 17 (API, then console) ─► R10 18 (API, then console)
```

### R0 — Prerequisites (Task 00)

| | |
|---|---|
| **Tasks** | 00 |
| **Gate** | Owner has pushed the `f9c2d8a3e17b` branch; `alembic heads` prints one head after the merge. |
| **Also before R1** | **Confirm the production startup command** in Azure Portal → `installflowapi` → Configuration → General settings. `.github/DEPLOYMENT.md` says it should be `python -m alembic upgrade head && gunicorn …`; the `publish-api` skill shows it without the migration. Record which is true in `.github/DEPLOYMENT.md` (§6.5). If it auto-migrates, every API publish also runs `upgrade head` against prod on restart — harmless when the owner has already migrated (a no-op), fatal if `main` carries a migration the owner has not run (§8 trap 1). Same check for `installflowapi-dev`. |
| **Prod migration** | `f9c2d8a3e17b`, **with the coordinate data loaded** (G1). Pre-flight: prod at `ea2fb2654b95`. |
| **API publish** | Optional — Task 00 changes no behaviour (model columns, CI, `requirements-dev.txt` which does **not** ship). |
| **adminWeb / mobile** | None (dev dependencies only; no native module). |
| **After** | §3.4 `f9c2d8a3e17b` checks on both DBs. `pytest`, `npm test` ×2 green in `pr-check.yml`. |

### R1 — Franchisees exist; nothing visible changes (Tasks 01, 02, 03, 04)

| | |
|---|---|
| **Tasks** | 01, 02, 03, and 04 (W2). |
| **Gate** | R0 done. Gate **(b2)**: all four merged and tagged together; dev round trips of `3b7e1f0a9c41` and `5d2a8c6e0b13` passed with ids compared (01 §7.2, 02 §7.1). Task 01 §7 and 02/03/04 §7 acceptance green on dev. API copy introduced by 03/04 (refusal sentences, carve-out bell, `franchisee_changed` note, admin-login email) read by the owner. Out of hours. |
| **Prod migration** | `alembic upgrade 3b7e1f0a9c41`, then `upgrade 5d2a8c6e0b13` — back to back. |
| **API publish** | **Immediately** after the second upgrade (01 §8: until it is live, the old API cannot raise a ticket, add a technician, close a job or take a redemption; each fails cleanly and rolls back). |
| **adminWeb** | Optional: Task 02 §5's type-level change (`FRANCHISE_ROLES` in `NOT_INVITABLE_HERE`) so Users & roles stops offering the new ranks. Without it the server refuses them (400), nothing worse. |
| **Mobile** | None. |
| **After** | §3.4 checks for both revisions. Run Task 01 §8's self-heal `INSERT INTO franchisees … WHERE NOT EXISTS` once (a company created by the old code in the gap). `audit_tenancy` exit 0. Owner's call: re-run `seed_play_review --production` as a smoke test (01 §8). **No non-home franchisee is created on prod until R3** (there is no console for it). |

### R2 — Technician operations and their money move to the franchisee; employees (Tasks 05, 06)

| | |
|---|---|
| **Tasks** | 05 and 06 together (W3). |
| **Gate** | R1 live. Tasks 05 §7 and 06 §7 green on dev; round trip of `7c4f2e9a1d58` with `ledger_entries.id` compared. 06's CSV layout and 05/06 server sentences read by the owner. Out of hours. |
| **Prod migration** | `alembic upgrade 7c4f2e9a1d58`. |
| **API publish** | **Immediately** — `ledger_entries.technician_type` is NOT NULL with no default (05 §3.3), so the R1 API cannot write any ledger row (closure, cancel, no-show, bonus) against it. Same promptness rule as R1. |
| **adminWeb** | None required. The staff console keeps working: the new response fields are additive. |
| **Mobile** | None. Old builds: employees would see a payout figure and an English 409 on Redeem — W8 keeps employees off prod until R4's gate. |
| **After** | §3.4 checks. `GET /ledger/pool` (no `franchiseeId`) as the client's NH returns the same figures as before the release (home). `GET /redemptions` unchanged for staff. |

### R3 — The two console screens (Tasks 08, 09)

| | |
|---|---|
| **Tasks** | 08 and 09 (gate **(d)**), plus Task 09 §5.10's staff commit `feat(console): staff screens learn franchisees`. |
| **Gate** | R2 live on prod (09 calls 05/06 endpoints). Copy **08 and 09 signed off** (index §7, gate (c)) before they were built. `npm run lint && npm run typecheck && npm test && npm run build` green. |
| **Prod migration** | None. |
| **API publish** | None. |
| **adminWeb** | `web-prod-deploy.yml` from the R3 tag. **Both tasks in one deploy** — never 08 without 09 (Task 08 §8 trap 1). |
| **Mobile** | None. |
| **After** | The client's Admin can open Franchisees and see one row, *Home*. A throwaway franchisee created and deleted on **dev** only. From here, prod can have franchisees. |

### R4 — Forward-compatibility: Task 07 on Play, console learns the new words

| | |
|---|---|
| **Tasks** | 07; Task 13 §5.1 (ledger kinds, fallbacks — never `NaN`) and the status half of §5.2 (`Awaiting Part` badge, filter, dashboard tile set) as their own commit (W7). |
| **Gate** | Task 06 on **dev** (07's contract; prod not required — W6). Copy **07 signed off**. Task 07 §7 criteria 1–12 on a dev build. |
| **Prod migration** | None. |
| **API publish** | None. |
| **adminWeb** | Deploy the console forward-compat commit to prod (may ride with R3 if it is ready by then). |
| **Mobile** | Owner re-runs `seed_play_review --production` (W9), then `eas build -p android --profile production` → `eas submit -p android --profile production` → Play **internal** track, draft (`eas.json`); owner promotes to **Production**, 100 % rollout. Record versionCode and date in Task 07's file; tick index §7. Test the update sheet from an install off the internal track, never a preview APK. |
| **Gate OUT (blocks R5, R6, R7)** | **X4:** the build shows *Available on Google Play* on the production track **and** Play Console → Statistics → active devices by app version shows **≥ 90 %** on this versionCode (or later). Stragglers are messaged to update. If the owner keeps Task 07's `X-App-Compat` header *and* adds a server-side count (not built by any task — see Owner decisions), that count may be used instead. |

### R5 — Travel allowance (Task 10) + base location in the console (Task 13) and the app (Task 14)

| | |
|---|---|
| **Tasks** | 10 (API); Task 13 commits for travel settings, the base-location map pin and the force-close travel field (13 §5.4 travel half, §5.5, §5.8); 14 (mobile). |
| **Gate** | **R4's gate OUT met** (gate (a) with the ≥ 90 % rule). Prod has `f9c2d8a3e17b`'s **data** (§3.4 count). Task 10 §7 green on dev, round trip of `9e1b5d3c7a26` (refuses once a `travel` row exists — run it before seeding any). Copy **13 (travel parts) and 14 signed off**. Gate (e) is trivially met for `travel` — it is not a pool kind and never reaches the console's pool screen — but R4's ledger fallbacks are live anyway. |
| **Prod migration** | `alembic upgrade 9e1b5d3c7a26`. Additive: the R2 API runs against it unchanged. |
| **API publish** | Promptly after; not time-critical (no NOT NULL without default). Every franchisee's rates are ₹0 (TA4) until somebody configures them, so nothing is paid on the day. |
| **adminWeb** | Deploy the Task 13 travel commits right after the API (they call `/settings/travel`, `/franchise/settings/travel`, the base-location routes). |
| **Mobile** | **After the API is live** (the onboarding step and Profile row PUT `/technicians/me/base-location`; against an older API they would 404): re-run `seed_play_review --production`, then a production EAS build carrying `react-native-webview@13.15.0` (the X3 native module — needs this new binary; Expo Go already has it), internal track → production. Map screen checked from an internal-track install before promotion (14 §7.18). |
| **After** | §3.4 checks. Release note: *tickets accepted before today never pay travel* (Task 10 §8 trap 13). |

### R6 — Speed allowance (Task 11) + the speed matrix in the console

| | |
|---|---|
| **Tasks** | 11 (API); Task 13 speed-rules screen and ticket speed panel. |
| **Gate** | R4's gate OUT met. Gate **(e)**: R4's console ledger commit is live on **both** console deploys (`POOL_SIGN` fallback — else the Penalty & Bonus screen prints NaN at the first speed row). Task 11 §7 green on dev (incl. 25: prod has 0 speed rules). **The speed-clock question is settled** (owner ruling 2026-10-15, index §6c R1: the clock starts at the later of the accept and the slot start; Task 11 W17) — the API must publish with `clock_start`/`slot_start` in place, and an empty matrix is still off. Copy 13 (speed) signed off. |
| **Prod migration** | `alembic upgrade b4a8e2f6c903`. Additive. |
| **API publish** | After the migration. |
| **adminWeb** | Speed commits after the API. |
| **Mobile** | None (Task 07 already renders `speed_reward`/`speed_penalty`; Task 15 shows the terms later). |
| **After** | §3.4 checks. `SELECT count(*) FROM franchisee_speed_rules` on prod is 0 until a franchisee admin configures one. |

### R7 — Spare parts and `Awaiting Part` (Task 12) + the parts screens in the console

| | |
|---|---|
| **Tasks** | 12 (API); Task 13 parts catalogue, facility queue and request page, facility users, ticket parts panel, reschedule-from-Awaiting-Part (`isReschedulable`). |
| **Gate** | R4's gate OUT met (07 knows `Awaiting Part` and `PARTS_PENDING`). Task 13 §5.2 status half on both consoles (R4). `d6c3a9f1e874`'s BEFORE lists fixed (§8 trap 2) and its round trip done with a part and a request seeded. Push text (five languages, `push_text.py`) and bell copy signed off with 13 (Task 12 §4.10). P4/D23 and D10 are **settled** (owner rulings 2026-10-15, R2 and R4: a facility may reject an approved request; no Admin/NH parts fallback, `NO_FACILITY`), the Task 12 §4.8b home facility-users routes and Task 13's *Facility users* card for home ship in the same release. |
| **Prod migration** | `alembic upgrade d6c3a9f1e874`. Additive for the old API — but see the rollback note in §7.3. |
| **API publish** | After the migration. |
| **adminWeb** | Parts commits **with** the API — a facility must be able to act before any technician can ask (no app can raise a request until R8, but staff could via dev tooling). Includes the home franchisee's *Facility users* card (owner ruling 2026-10-15, R4): without it a home franchise has no way to get its first facility admin and its technicians' requests answer `NO_FACILITY`. |
| **Mobile** | None yet. |
| **After** | §3.4 checks. `SEGMENTS["inprogress"]` includes `Awaiting Part` (verify on dev with a hand-set status, Task 07 §7.9). |

### R8 — Parts and allowances in the app (Task 15), then the docs pass

| | |
|---|---|
| **Tasks** | 15; this task's final AGENTS.md pass (§6). |
| **Gate** | R7 live (15 §8: its buttons need Task 12's server). R5's Task 14 build is the base (15 depends on 14). Copy **15 signed off**. |
| **Prod migration / API / adminWeb** | None. |
| **Mobile** | Re-run `seed_play_review --production` (W9) — now with the parts additions of §5.4 — then production EAS build → internal → production. |
| **After** | The §7.2 smoke on dev passes end to end. §6 prose reconciled with the code as merged. Index §7 checklist fully ticked. |

### R9 — Technician transfer (Task 17)

| | |
|---|---|
| **Tasks** | 17 (API `POST /technicians/{id}/transfer`, `technician_transfers`; console dialog on the technician profile). |
| **Gate** | R1, R2 and R3 live (Tasks 05, 06, 08, 09). Copy **17 signed off**. |
| **Prod migration** | `e8a2c5b7d913` (additive; its downgrade refuses while any row exists) — the owner runs it, then the API is published. |
| **API / adminWeb** | API first, then the console action. No mobile build (the technician gets a push, `technician.moved`, which the installed app shows as an ordinary notification). |
| **Verify** | `audit_tenancy` (TENANT_LINKS 18 → 21), `cleanup_db` classifies `technician_transfers`, and a `seed/verify.py` check that a transferred technician's old ledger rows keep their franchisee. |
| **Rollback** | Hide the console action; the route is inert without callers; downgrade only while `technician_transfers` is empty. |

### R10 — Hand a ticket to another franchisee (Task 18)

| | |
|---|---|
| **Tasks** | 18 (API `POST /tickets/{id}/franchisee`, `GET /tickets/{id}/franchisee-options`, `tickets.routing_override`; console action on the staff ticket page). |
| **Gate** | R9 live (its migration is the tail of the chain); R1–R3 live; Task 12 live if tickets with part requests are in play (hand-over is refused once a job has started). Copy **18 signed off**. |
| **Prod migration** | `f3b9d1a6c845` (adds `tickets.routing_override` NOT NULL DEFAULT false) — the owner runs it, then the API is published. API first, then the console. No mobile build. |
| **Verify** | `seed/verify.py`: no ticket has `routing_override = true` while its franchisee owns the pincode; the five eligibility places agree (pool, push targeting, assign guard, socket, accept). `audit_tenancy` unaffected (no new table). |
| **Rollback** | Hide the console action; clear flags only after re-stamping those tickets to their pincode owner; downgrade drops the column. |
| **AGENTS.md** | One paragraph in root and api AGENTS.md: *a handed-over ticket is the one place a technician may be eligible without covering the pincode*. |

---

## 5. Seeds, verify, cleanup and the tenancy audit

All paths under `api/app/scripts/`. Checked against `dev @ 6763026`. "Owner" = the task that owns the edit;
anything marked **Task 16** is new here and lands in R8 (or earlier, with the feature it exercises, if that
task's implementer prefers).

### 5.1 `seed_synthetic.py`, `seed_demo.py` and the shared `seed/` package

Today `seed/tenant.build` creates the company (→ `create_company`), staff, a vendor, the catalogue and
technicians through the services, and `seed/lifecycle.drive` drives tickets through `create_ticket`,
`jobs_service.accept/submit_proof/complete/cancel`, `force_close_ticket` and `record_feedback`. **No seed
calls `core.ledger` directly** (grep-verified: no `pool(`, `entry(` or `credited(` under `scripts/`), so Task
05 §8 trap 5 needs no change. `seed_demo.py` reuses `tenant`/`lifecycle`/`verify`, so every change below
reaches it too.

| # | File | Change | Owner |
|---|---|---|---|
| 1 | — | **Nothing is required for the seeds to keep running.** Every INSERT goes through a service that Tasks 01/05/10 teach to stamp `franchisee_id`, `technician_type` and the snapshot (01 §4.8). Staff-created technicians default to home + freelancer (05 §4.5). | 01 |
| 2 | `seed/tenant.py` | **Exercise franchisees.** After the technicians exist and before any ticket: create one **external** franchisee (`Crestline Field Services {tag}`) through `features.franchisees.service` with an admin at `franchise.{tag}@seed.example.com` (email fails → temporary password printed, the vendor-login pattern), then `set_pincodes` with the **second half** of the seed's 20 pincodes — a real carve-out, so technicians wholly inside move and partial ones are trimmed (F6). Print the moved/trimmed counts. Add `principal_for(..., franchisee_id=)` so later steps can act as that admin. | Task 16 |
| 3 | `seed/tenant.py` | **Employees.** Make every fifth technician of each franchisee an `employee` (`update_technician` as the right principal — staff for home, the franchise admin otherwise), before any job is accepted. Keep at least one freelancer per franchisee. | Task 16 (after R2) |
| 4 | `seed/tenant.py` | **Travel.** Configure both franchisees' freelancer **and** employee rules to non-zero (`free 20/30, step 2, ₹10, 130 %, max ₹300`) through `core.travel_rules.put_travel_rules`. Give 4 of every 5 technicians a base (`source = 'pincode'`, the first of their pincodes **with** coordinates); leave the fifth unset so `no_base_location` is produced. | Task 16 (after R5) |
| 5 | `seed/tenant.py` | **Speed.** One node-level rule per franchisee × freelancer on the first main sub-category (`12 h → ₹200 / 24 h → ₹150`), via `core.speed_rules`. Leave employees with no rule (`speed: null` path). | Task 16 (after R6) |
| 6 | `seed/tenant.py` | **Parts.** Two `spare_parts` on the first main sub-category's leaf (`Drain pump`, `Door lock`) and one on its first model; one facility operator per franchisee **including the home franchisee** (owner ruling 2026-10-15, R4: there is no Admin/NH fallback, so a franchisee without one answers `NO_FACILITY`; home's is created through the same helper) through `core.franchise_logins` (seed address). Leave one extra seeded franchisee **without** facility staff so the `NO_FACILITY` path is read. | Task 16 (after R7) |
| 7 | `seed/lifecycle.py` | **MIX** gains `("awaiting_part", 0.02)` taken from `in_progress` (shares must still sum to 1). The intent = `in_progress` + `core.spare_parts` raise of `Drain pump` as the technician — slot kept **ahead**, or `verify._live_tickets_still_have_a_future` fails. A third of `closed` tickets also raise a part before completion, which the facility operator approves and issues (and, for half of those, logs returned) — so `_parts_agree_with_status` reads terminal tickets with settled requests. | Task 16 (after R7) |
| 8 | `seed/lifecycle.py` | `force_closed` passes `travelPaise = None` (omitted) — W5 of Task 10: pays no travel, and `_travel_matches_the_snapshot` only reads `Closed`. No change needed; documented here so nobody "fixes" it. | — |
| 9 | `seed/backdate.py` | `_TICKET_CHILDREN` gains `("spare_part_requests", "ticket_id", ("created_at", "updated_at", "decided_at", "issued_at", "returned_at"))`. `shift_ticket` also shifts `accept_snapshot->>'acceptedAt'` by the same delta (`jsonb_set(accept_snapshot, '{acceptedAt}', to_jsonb((…)::timestamptz - :delta))` when not NULL), or the frozen accept time reads six weeks after the timeline's `assigned` event. Speed money is written before backdating and every event moves by one delta, so measured durations are unchanged. | Task 16 (after R5 / R7) |
| 10 | `seed_demo.py` | `_one_redemption` must pick a **freelancer** (employees get 409 `EMPLOYEE_CANNOT_REDEEM`, Task 06). | Task 16 (after R2) |
| 11 | `seed_synthetic.py` docstring / `--plan` | Print the franchisee, its pincode count, employee count, rules configured. | Task 16 |

### 5.2 `seed/verify.py`

Today `run()` holds five checks: `_events_are_in_time_order`, `_closed_tickets_were_paid`,
`_earnings_match_the_ledger`, `_nobody_passed_the_monthly_cap`, `_live_tickets_still_have_a_future`.

| Check | Change | Owner / release |
|---|---|---|
| `_company_has_one_home` | **New.** Exactly one live home; zero `franchisee_pincodes` on it (F4). | 01 / R1 |
| `_open_unassigned_tickets_route_by_pincode` | **New.** Stamped `franchisee_id` of open unassigned tickets = `franchisees_for_pincodes(...)`. | 01 / R1 |
| `_technicians_on_live_franchisees` | **New.** No live technician on a deleted/inactive franchisee. | 01 / R1 |
| `_closed_tickets_were_paid` | Skip tickets whose job type is `employee` (06 §4.10). **After R5:** read the type through `core.accept_snapshot.technician_type_of` (frozen type; profile type only when the snapshot is NULL) — 06 §8 trap 2 / 10 trap 10. | 06 → 10 |
| `_employees_were_not_paid` | **New.** No `payout` row with `technician_type = 'employee'`. | 06 / R2 |
| `_earnings_match_the_ledger` | `earned = payout + travel` and assert `earnedPaise == payout + travel`, `travelPaise == travel` (10); `bonuses += speed_reward`, `penalties += speed_penalty`, reversed rows excluded as the screen does (11). | 10, 11 |
| `_travel_matches_the_snapshot` | **New.** One `travel` row of the frozen amount per `Closed` ticket whose snapshot pays its holder; none above `maxPaisePerJob`; none without a snapshot. | 10 / R5 |
| `_every_franchisee_has_travel_rules` | **New.** Exactly two rows per franchisee. | 10 / R5 |
| `_nobody_passed_the_monthly_cap` | `kind IN ('penalty','speed_penalty')` **and not reversed** (`core.ledger.not_reversed()`). | 11 / R6 |
| `_speed_rows_are_honest` | **New.** Every `speed_*` row on a `Closed` ticket with a non-null `speed` snapshot; ≤ 1 per ticket; none on `Force-Closed`. | 11 / R6 |
| `_parts_agree_with_status` | **New.** Four clauses of Task 12 §4.11. | 12 / R7 |
| `_ledger_franchisee_matches_the_snapshot` | **New (Task 16).** For every `payout`/`travel`/`speed_*` row on a ticket with a non-null snapshot: `ledger_entries.franchisee_id = (accept_snapshot->>'franchiseeId')::uuid` and `technician_type = accept_snapshot->>'technicianType'`; every `reversal` carries its penalty's `franchisee_id`. Two writers, one fact (index §3.2). | Task 16 / R5 |
| `_pool_per_franchisee_adds_up` | **New (Task 16).** For each franchisee: `core.ledger.pool(...)`'s `balancePaise` = the SQL of Task 11 §7.15 (F12's formula), and `penaltiesCollectedPaise − bonusesPaidPaise = balancePaise`. | Task 16 / R6 |
| `_statements_match_the_ledger` | **New (Task 16).** For each employee and the current IST month: `core.statements` credit/debit totals = Task 06 §7.10's SQL. | Task 16 / R2 |

### 5.3 `cleanup_db.py`

| Change | Owner | Note |
|---|---|---|
| `COMPANY_TABLES += {"franchisees", "franchisee_pincodes"}` | 01 | |
| `COMPANY_TABLES += {"franchisee_travel_rules"}` | 10 | in Task 10's own commit (reconciled into Task 10) — `cleanup_db` refuses to run with an unclassified table and Task 01's unit test 13 fails CI without it |
| `COMPANY_TABLES += {"franchisee_speed_rules"}` | 11 | in Task 11's commit (11 §3.5) |
| `COMPANY_TABLES += {"spare_parts", "spare_part_requests"}` | 12 | in Task 12's commit (12 §3.2) |
| `MONEY_SUMS` | none | `travel`, `speed_*` are `ledger_entries` rows, already summed; parts carry no money (P5). |
| `PROTECTED_COMPANY_SLUGS` | none | `RGT Play Review` keeps its home franchisee with it. |
| `ALLOWED_DANGLING_FKS` | **none — deliberately** | `technician_profiles.base_set_by_user_id → users` is a real FK (`ON DELETE SET NULL`, Task 10). A kept technician whose base was set by a user being deleted would stop the run; that cannot happen today (anyone who acted in a kept company keeps an account through its membership row), and if it ever does, the refusal is the right outcome. `spare_part_requests.*_by_user_id` carry no FK (`PLAIN_USER_COLUMN` lists them, not refused). |
| Franchise logins | none | They are `users` with a `memberships` row: kept with a kept company, deleted with a deleted one — decision 2 unchanged. `delete_order` derives `memberships`/`tickets`/… → `franchisees` from the live FKs. |
| Run | — | `python -m app.scripts.cleanup_db --check` after each of 01/10/11/12; `--rollback` once on dev after R7 (the new tables have only been planned against). |

### 5.4 `seed_play_review.py` — the reviewer stays a home-franchisee freelancer

| Change | Release |
|---|---|
| After `_technician` loads or creates the reviewer: **refuse** (`SeedRefused`) unless `existing.franchisee_id == await home_franchisee_id(db, company.id)` and `existing.technician_type == "freelancer"`, naming what is wrong. Refuse, don't repair: a non-home reviewer means somebody carved pincodes out of `RGT Play Review`, and silently undoing a carve-out is worse than stopping before a submission. Also refuse if the company has **any** non-home franchisee: the review company is a fixed demo. | R1 (code), enforced from R4 |
| `staff`-created via `create_technician` already lands on home + freelancer (05 §4.5); no request field to set. The reviewer's `TechnicianCreateRequest` must not pass `technicianType`. | R2 |
| Set the reviewer's base location (`source='pincode'`, the first picked pincode with coordinates) when unset, through `core.base_location` — so Home shows no *Set your base location* card to a reviewer and the Allowances card has a travel line. Leave the review company's travel rules at the ₹0 defaults (no money configured in a demo tenant). | R5 |
| `_clear_stale` and `_count` (`Ticket.status.in_(("Assigned", "In Progress"))`, lines ~487 and ~620) add `"Awaiting Part"` (12 §4.6). `_clear_stale`'s force-close passes `technicianPayoutPaise=0` and no `travelPaise` → pays nothing, no speed (S5). | R7 |
| One `spare_parts` row on the review catalogue's category and one in-progress job with an open request, so the reviewer's *In progress* tab shows *Awaiting part* and the picker is not empty. | R8 |
| Docstring and api/AGENTS.md "Google Play review sign-in" mention the home-franchisee / freelancer invariant (§6.2). | R8 |

### 5.5 `audit_tenancy.py` — `TENANT_LINKS` additions (18 in all)

| Owner | Links |
|---|---|
| 01 | `("franchisee_pincodes","franchisee_id","franchisees")`, `("memberships","franchisee_id","franchisees")`, `("technician_profiles","franchisee_id","franchisees")`, `("technician_invites","franchisee_id","franchisees")`, `("tickets","franchisee_id","franchisees")`, `("ledger_entries","franchisee_id","franchisees")`, `("redemptions","franchisee_id","franchisees")` |
| 05 | `("notifications","franchisee_id","franchisees")` |
| 10 | `("franchisee_travel_rules","franchisee_id","franchisees")` |
| 11 | `("franchisee_speed_rules","franchisee_id","franchisees")`, `(…,"node_id","product_nodes")`, `(…,"model_id","product_models")` |
| 12 | `("spare_parts","node_id","product_nodes")`, `("spare_parts","model_id","product_models")`, `("spare_part_requests","franchisee_id","franchisees")`, `(…,"ticket_id","tickets")`, `(…,"technician_id","technician_profiles")`, `(…,"spare_part_id","spare_parts")` |

`GLOBAL_TABLES` and `KNOWN_FUNCTIONS`: no additions. Not tenant links, correctly: `franchisee_pincodes.pincode`
and `technician_profiles.base_pincode` → `pincodes` (global master), `base_set_by_user_id` → `users`.
⚠ The script proves links across **companies**; that one franchisee cannot read another's rows inside a
company is an application invariant (`core.franchise_scope`) it cannot see — same caveat as vendors (api
hard rule 7).

---

## 6. AGENTS.md and skill updates

Each block is tagged with the release that makes it true (W10). Text in quotes is drafted to paste.

### 6.1 Root `AGENTS.md`

**Edits to existing text**

| Where | Change | Rel. |
|---|---|---|
| *Phase: partly bound*, first list | Add "**franchisees and their pincode territories, the franchise portal, employees and their statements**" (R3), "**travel allowance**" (R5), "**speed allowance**" (R6), "**spare parts**" (R7). | R3–R7 |
| *AI verification is HIDDEN* | "`AI Review` is still one of the nine ticket statuses" → "still one of the ticket statuses" — the count was already wrong (ten) and becomes eleven. | R7 |
| *A job is priced* | Append: "**An employee is paid no per-job payout** — neither on closure nor force-close; the price is still stamped on the ticket (it is the product's price). Which kind of technician did the job is the type frozen when they accepted it." | R2 (R5 for the last clause) |
| *A payout is not pool money* | "the penalty pool is a closed circuit — `balance = penalties − bonuses`" → "**one penalty pool per franchisee**, a closed circuit — `balance = penalties + speed penalties − reversals − bonuses − speed rewards`, scoped by `ledger_entries.franchisee_id`". `travel` joins `payout` as "not pool money". | R2 / R6 |
| *A technician cashes out by REDEEMING* | Payer: "the company's **National Head, or its Admin when it has none**" → "for a **home-franchisee** technician the company's National Head, or its Admin when it has none (and the home's franchisee admins alongside); for any other franchisee, **that franchisee's admin**". Add: "**An employee cannot redeem** (409 `EMPLOYEE_CANNOT_REDEEM`); their franchisee admin downloads a monthly statement instead." | R2 |
| *A technician adds their UPI ID ONCE* | Reviewer chain gains: "— for a technician of a non-home franchisee, **that franchisee's admin** (`reviewer_role = 'franchisee_admin'`)". | R2 |
| Domain facts → *Cancelling costs money* | Append: "A **speed penalty** counts against the same monthly cap." | R6 |
| Domain facts → *A penalty can be given back* | Append: "A **speed penalty** is reversible by the same people, and also by the technician's **franchisee admin** from the portal's pool screen. A reversal returns money to the pool that collected the penalty, even if the technician has since moved franchisee." | R2 / R6 |
| Domain facts → *Assignment is first-accept-wins* | Append: "— among the technicians of the **ticket's franchisee** only." | R1 |
| Domain facts → *Bandwidth* | No change (`Awaiting Part` is non-terminal; a revisit counts on its slot day — say so in one clause). | R7 |
| *Stack* | Add `react-native-webview` (OpenStreetMap pin, Task 14). Console: `leaflet` + `react-leaflet`, lazy chunk only. | R5 |
| *Do not add any other third-party native module* sentence | "…without flagging it first" → keep, and add: "`react-native-webview` was flagged and added for the base-location map (franchisee Task 14); a module it would replace (`react-native-maps`) is not wanted." | R5 |
| *Layout* (mobileapp tree) | `src/features/base-location/`, `src/features/parts/`; routes `(app)/base-location`, `(app)/base-location/map`, `(app)/job/[id]/parts`. adminWeb line: "(staff, vendor portal `/portal/*`, franchise portal `/franchise/*`)". | R5 / R8 |
| *Commands* | `npm test` in both clients; `cd api && pip install -r requirements-dev.txt && python -m pytest` (pure, no database). The production migration line becomes `$env:CONFIRM_PROD='yes-i-mean-it'; $env:POSTGRES_DB='RelianceProdDB'; python -m alembic upgrade <revision>` — `alembic/env.py` refuses without the first variable. | R0 |
| *Testing onboarding without Meta credentials* | One line: a franchisee-admin or facility login created on dev with a `@seed.example.com` address returns its temporary password in the response. | R3 |

**New "Domain facts that are easy to get wrong" bullets** — insert after *Only a VENDOR raises a ticket* and its
neighbours, before the pool/assignment bullets. Drafted in the file's voice:

```markdown
- **Every company runs FRANCHISEES, and a franchisee runs the technicians.** A franchisee is
  `internal` (the company itself, under another name) or `external` (a separate business leasing the
  company's name — SkyFix running Acme's work in 500030–500040). Every company has exactly one **home**
  franchisee, created with it, internal, and impossible to delete or make external. Its name is the
  company's own, its code is `HOME`, and it owns **every pincode nobody else claims** — which is why it
  stores no pincode rows at all and why a ticket can never be without a franchisee.
  ⚠ Not to be confused with the WHITE-LABEL brand: the brand on every screen is still the company. An
  external franchisee's name appears only as the second line of its own portal's rail and in its file
  names; it never replaces the company's tile.
- **A franchisee is given PINCODE RANGES, and no two franchisees share a pincode.** `500001-500099,
  500120` is expanded against the geography master and only codes that exist and are active are stored.
  A range that touches another franchisee's code is refused with 409 `FRANCHISEE_PINCODE_TAKEN`, naming
  the clashing codes and their owners; `uq_franchisee_pincodes_company_pincode` is what settles the race.
- **Giving a franchisee pincodes is a CARVE-OUT, and it moves people and unassigned work — never assigned
  work.** A technician whose coverage lies entirely inside the new set moves to the new franchisee; one
  with some coverage inside loses those pincodes (one who would be left with none moves instead). Open
  tickets nobody holds are re-stamped, each with a `franchisee_changed` event. A job somebody already
  holds keeps its technician AND its franchisee. The save previews all of it first (`dryRun=true`), and
  taking pincodes away hands them back to home by the same rules.
- **A ticket's franchisee is stamped at intake from its pincode, and only that franchisee's technicians
  are offered it.** All three intake channels stamp it; all five eligibility places (pool, push
  audience, accept, assign, the pool socket) test it, live, against where the technician is NOW. A
  technician cannot be given a pincode outside their franchisee (422 `PINCODE_OUTSIDE_FRANCHISEE`).
- **Tickets stay company work; technicians and their money are the franchisee's.** Admin, National
  Head, Regional Head and Area Manager still escalate, reschedule, assign and force-close every ticket,
  the dashboard included. The **franchisee admin** adds, invites and edits its technicians, sets their
  type and base, approves their UPI changes, pays their redemptions, reverses their penalties, runs its
  pool, its travel and speed settings and its facility staff, and downloads employee statements. It
  sees its franchisee's tickets **read-only**. For the **home** franchisee nothing changed: the existing
  roles keep today's rules, and home may also be given franchisee admins who act alongside them. Company
  staff can READ a non-home franchisee's technicians but not change them (403 "Managed by …"), and
  Admin/NH can still reverse a penalty anywhere.
- **Franchise logins are a third family of roles, and rank never decides their authority.**
  `franchisee_admin`, `facility_admin`, `facility_operator` (ranks 8–10, below every staff role) are
  created only on the Franchisees screen (and facility users from the portal — plus, for the **home** franchisee, by the
  company's Admin / National Head on its Franchisees page, owner ruling 2026-10-15), with a generated, emailed
  temporary password — never on Users & roles. They sign in to the same console and land in
  `/franchise/*`, a restricted portal beside the vendor's. Test `FRANCHISE_ROLES`, never the number: a
  franchisee admin outranks nobody and manages people a National Head may not. Another franchisee's
  technician, ledger row or part request answers **404**, the same as another company's.
- **A technician is an EMPLOYEE or a FREELANCER**, freelancer by default, set by whoever adds them and
  changed by their franchisee admin. An employee gets **no per-job payout** and **cannot redeem** — their
  franchisee admin downloads a monthly statement (CSV, IST calendar month) to add to salary; the salary
  itself is not recorded here. Employees still earn travel, speed rewards, bonuses and still pay
  penalties. The type that counts is the one **frozen when the job was accepted**, and every ledger row
  stamps the type it was written under, so a later change never re-labels old money. A freelancer with
  money still to redeem cannot be made an employee (409 `TECHNICIAN_HAS_BALANCE`), nor can anyone with an open job (409
  `TECHNICIAN_HAS_OPEN_JOBS`).
- **What depends on the TECHNICIAN is frozen at ACCEPT; what depends only on the ticket is frozen at
  INTAKE.** `tickets.rules_snapshot` (intake) holds the company's rules; `tickets.accept_snapshot`
  (accept) holds the franchisee, the type, the travel figure and the speed terms. A re-accept after a
  release re-stamps it. A ticket accepted before this existed has NULL there and pays neither allowance
  — read it through `core.accept_snapshot`, never with a bare `[]`.
- **Travel allowance is paid for distance beyond a free allowance, from the technician's BASE to the
  customer, one way.** Straight line × a road factor (130 %), the customer point from the ticket's map
  pick else its pincode's centre; no point → 0 km, recorded with the reason. Beyond the free distance
  (20 km freelancer, 30 km employee) every whole step pays a rate, capped per job; **the defaults are ₹0,
  so it is off until a franchisee configures it.** Paid as a `travel` ledger row on the customer's
  confirmation; on a force-closure the manager's form starts at the frozen amount and may change it,
  capped. Never on a cancellation. `travel` is the technician's money, not pool money.
- **A technician's base is where they start from, and it is copied, not linked.** Set by the franchisee
  admin (a pin on the console's OpenStreetMap) or by the technician (a home pincode inside their
  franchisee, GPS, or a pin) — onboarding, Profile, or the Home card until set. No base at accept means
  ₹0 travel for that job, never a refused accept. Company staff (Area Manager and above) see a job's travel AMOUNT **and** its speed outcome on any ticket in scope, a non-home
  franchisee's included (owner ruling 2026-10-15) — but never the base's coordinates: where a technician sleeps is not ticket
  data. A self-set base needs no approval and has no cooldown; its source and who set it are shown to the franchisee admin
  (and home managers), who can correct it at any time. A franchisee's **last active admin** cannot be deactivated unless it is
  the home franchisee (409 `FRANCHISEE_LAST_ADMIN`) — there is no company fallback for a non-home franchisee's UPI changes or
  redemptions.
- **Speed allowance rewards a fast job and charges a slow one**, per franchisee × type × category or
  product (a product's row beats the deepest category's; nothing matching means nothing paid). The clock
  runs from the **later of the accept and the slot's start** (no slot: the accept) to Complete, **minus time spent in
  `Awaiting Part`**; a reschedule moves the slot, so the slot in force at completion counts, and a slot that starts after
  completion is 0 hours. Staff and the franchisee admin see the outcome; facility staff and vendors do not.
  Within the reward hours → `speed_reward`; past the penalty hours → `speed_penalty`; between →
  nothing. Measured at completion, written on the customer's confirmation, **never on a force-closure**.
  Both are pool kinds: the reward is paid from the franchisee's pool like a bonus, the penalty funds it,
  counts against the monthly cancellation cap, and is reversible like any penalty. An empty matrix is
  off.
- **A technician asks for a SPARE PART only after starting, and the job then waits in `Awaiting
  Part`.** The list is the category's (inherited down the tree) plus the product's own, or *Other* with a
  typed name. Complete is refused while any request is `requested` or `approved` (409 `PARTS_PENDING`);
  when every request is issued, returned or rejected the job returns to `In Progress`. The franchisee's
  **facility** staff log every step — approve or reject (an **approved** request may still be rejected, with a reason),
  *new part issued*, *old part received back* — and the technician only raises. **Nobody in the staff console works the
  queue, the home franchisee included:** a franchisee with no active facility admin or operator answers a request with 409
  `NO_FACILITY` and the app hides *Need a spare part* (`partsEnabled`); company Admin / National Head add the home
  franchisee's facility users. No money and no stock counts: it is a log of who did what, when. A
  revisit uses the ordinary reschedule, which now also moves a started job.
- **`Awaiting Part` is the eleventh ticket status, and it is NOT terminal.** It sits under *In progress*
  in the app, holds the vendor's credit reservation, blocks deleting its technician, counts on its slot
  day against the daily cap, and can be force-closed. Installed apps older than the franchisee
  forward-compatibility build misread an unknown status — which is why Task 07 shipped first.
- **Every technician rupee carries the franchisee that paid it.** `ledger_entries.franchisee_id` is the
  technician's franchisee when the row was written, except a `reversal`, which copies the penalty's so
  money goes back to the pool that collected it. A technician moving franchisee never moves money
  already written. Money between an external franchisee and the company (lease, revenue share) is not
  in this product; the column is there so it can be reported later.
- **Pincode centres are trusted as loaded.** `pincodes.latitude/longitude` came with `f9c2d8a3e17b`
  (19,195 of 19,496 have one). A missing point is 0 km, never a district guess, and a wrong one is
  corrected in the master — not by special-casing a code.
```

### 6.2 `api/AGENTS.md`

**New sections** (after "Reversing a penalty", in this order):

| Section | Content (from the task docs — paste their docstrings' WHY, not their code) | Rel. |
|---|---|---|
| **Franchisees — who runs a company's technicians** | `franchisees` / `franchisee_pincodes`; one home per company (`uq_franchisees_one_home`, `ck_franchisees_home_is_internal/_is_permanent`), name = company name, code `HOME` reserved; F4 catch-all (`franchisee_pincodes_subquery(is_home=True)`); `core.franchise` is the one place that answers "who owns this pincode"; `create_company` creates the home in its own transaction; the backfill's shape and "migrate prod, then publish PROMPTLY" with the self-heal SQL (the credits precedent). | R1 |
| **Ranges and the carve-out** | `core.pincode_ranges` (pure grammar, en dash, 422 naming tokens); `core.carve_out` planner (pure) and the apply order; `lock_routing` — exclusive for a carve-out, shared for intake and coverage checks; lock order routing → credits → vendor credit; dry run never locks; the tickets UPDATE stays conditional (`technician_id IS NULL AND status IN …`) so an accept mid-carve-out stays assigned; `Escalated` with no technician is re-stamped too; no DELETE for a franchisee (NOT NULL history). | R1 |
| **Franchise principals — the second wall inside a company** | `FRANCHISE_ROLES` / `FACILITY_ROLES`; `Principal.franchisee_id` from the membership, never a token claim; `FranchisePrincipal` = franchisee admin only, `FacilityPrincipal` = any of the three; why `ensure_below_rank` and `require_min_rank` must never decide franchise authority; `core.franchise_scope.managed_franchisee_ids(purpose=manage|view|reverse)` and `can_manage_technician` as F7/F8 in one place; franchise callers see tickets by **ownership** (`tickets.franchisee_id`), never through `visible_pincodes`; a switched-off franchisee → 403 on every call; `vendorPricePaise` withheld from franchise principals; Users & roles refuses franchise roles (400). | R1 |
| **The `/franchise/*` twins** | Portal routes live as a second router inside the slice that owns the logic (`technicians`, `redemptions`, `ledger`, settings…), so slices never import each other; `features/franchise_portal/` only for portal-native endpoints (technician-options, pincodes, me, facility-users). Every twin carries **both** `FranchisePrincipal`/`FacilityPrincipal` and its `require_feature("franchise.…")`. | R2 |
| **Employees and statements** | `core.employment` (`pays_per_job`, `may_redeem`); no payout on closure; force-close **ignores** (not refuses) the payout field for an employee and says so in the event note; `ledger_entries.technician_type` and why it has no server default; the redeemable balance is the freelancer stream only; `TECHNICIAN_HAS_BALANCE`; statements: month WRITTEN, reversals as their own lines, kind-generic (`kind <> 'payout'`, never an IN list), a CSV not wrapped in the envelope and built whole before returning. | R2 |
| **`accept_snapshot` — what depended on the technician** | Index §3.5 shape; written BY the guarded UPDATE (exists iff this technician won); `JSONB(none_as_null=True)` and why; every path that clears `technician_id` clears it in the same statement; read through `core.accept_snapshot` (`travel_of`, `speed_of`, `technician_type_of`) — NULL reads as "nothing to pay". | R5 |
| **Travel allowance** | TA1–TA8 in prose; integer tenths of a km (W1); `0/0` = off and the W2 refusal; `franchisee_travel_rules` stamped on franchisee creation and self-healed by `load_travel_rule`; `uq_ledger_entries_one_travel`; force-close `travelPaise` omitted = nothing (the `ForceCloseRequest` doctrine); folded into `earnedPaise` with `travelPaise` as a breakdown — never a fourth term; the API still never calls a map service. | R5 |
| **Base location** | Columns, CHECKs, sources and who may send which (W8); copied coordinates (W7) and the re-copy rule for a future pincode-centre correction; `PINCODE_OUTSIDE_FRANCHISEE` / `PINCODE_HAS_NO_LOCATION` / `BASE_OUTSIDE_INDIA` as 400 `AppError`s (the app translates by code); coordinates only on technician-management endpoints; the abuse note (cap + `base_set_at` + frozen source make it visible, not impossible). | R5 |
| **Speed allowance** | S1–S6; `core.speed` (pure: `speed_outcome`, `clock_start`, `working_hours`, `clock_from_events(events, slot_start)`), `core.speed_rules`, `core.speed_settle`; the clock starts at `max(accept, tickets.slot_start)` (owner ruling 2026-10-15, W17); exact-second boundaries; latest `completed` and latest `assigned` before it by `seq`; `Awaiting Part` intervals read off `from_status`/`to_status`; reward paid even from a negative pool; `capped_charge` under the profile lock; `uq_ledger_entries_speed_once`; `speed_settled` carries no rupee amount and is hidden from vendors; staff edit only the home matrix (`settings.edit` + NH floor, the same guard as home travel). | R6 |
| **Spare parts and `Awaiting Part`** | Catalogue inheritance (`node_path_ids` + the model's own); request states and `TRANSITIONS`; `spare_part_requests.franchisee_id` = the ticket's; idempotent repeat while open; `FOR NO KEY UPDATE` on the ticket, never `FOR UPDATE`; flush before `settle_job_status`; capture `was` before an ORM UPDATE; facility actions allowed in any ticket status (physical facts); `SPR` sequence; no customer PII on `PartRequestOut`; no Admin/NH fallback for home (`franchisee_has_facility`, 409 `NO_FACILITY`, `partsEnabled`); `approved → rejected` with `rejected_from`; the `facility` audience and its four readers; every status set that learned `Awaiting Part` (12 §4.6) and the ones that deliberately did not; return photo is a blob NAME under `attachment/{company_id}/`. | R7 |

**Edits to existing sections**

| Section | Change | Rel. |
|---|---|---|
| Intro "Live today" + "Still to come" | Add franchisees, the franchise portal, employees/statements; later travel, speed, parts. | R1–R7 |
| Hard rule 1 (multi-tenant) | One paragraph: "**A franchisee is a second wall inside the company.** A franchise principal asking for another franchisee's technician, ledger row, redemption or part request gets 404, exactly as for another company." | R1 |
| Hard rule 6 (migrations) | Add `uq_franchisees_company_name_lower`, `uq_spare_parts_node_name`, `uq_spare_parts_model_name`, `uq_spare_part_requests_open_name` to the false-drop list; "a migration that rewrites a CHECK vocabulary spells the BEFORE list out and asserts it against `pg_get_constraintdef` (`d6c3a9f1e874`'s `_assert_check_is`) — parallel tasks otherwise silently drop each other's values". | R1 / R7 |
| Hard rule 7 (vendor) | Retitle the scope table "who sees which tickets": rows for `franchisee_admin` (`franchisee_id = mine`, read-only) and facility roles (tickets with a part request of their franchisee). "Four kinds of principal sign in: staff, technicians, vendors and franchise users." | R1 / R7 |
| "Job payouts are live" | Employees: no payout, force-close field ignored. `LEDGER_KINDS` now also `travel`, `speed_reward`, `speed_penalty`; "A payout is not pool money" bullet → pool per franchisee, `POOL_KINDS` gains the two speed kinds, `travel` is not one. | R2 / R5 / R6 |
| Redemptions bullets | Payer: home → `core.coverage.payer_role` as today plus the home's franchisee admins; non-home → that franchisee's admin (`audience='franchisee_admin'`); `redemptions.franchisee_id` frozen at request; employees refused. | R2 |
| "A UPI ID is added once" | `upi_reviewer` gains the non-home branch (`franchisee_admin`); `_load_managed` → 403 "Managed by …" for staff. | R2 |
| "Reversing a penalty" | Two doors, one body (`core.penalty_reversal`): the ticket page (staff, as today) and the portal pool screen (franchisee admin); `speed_penalty` is reversible; the reversal copies the penalty's `franchisee_id`; readers table gains `speed_penalty` rows. | R2 / R6 |
| Notifications audience note (in Credits / Vendor credit) | Audience lives in **four** readers — `_visible`, `users_notified_by`, `ws.hears_notification`, `core.audience.hears`; `franchisee_admin` (R2) and `facility` (R7) added; `notifications.franchisee_id`; a row with `franchisee_id IS NULL` never reaches a franchise reader. | R2 / R7 |
| Layout | `core/`: `franchise`, `franchise_scope`, `franchise_logins`, `franchise_routing`, `carve_out`, `pincode_ranges`, `audience`, `franchise_money`, `penalty_reversal`, `employment`, `statements`, `accept_snapshot`, `travel`, `travel_rules`, `base_location`, `speed`, `speed_rules`, `speed_settle`, `spare_parts`. Slices: `franchisees`, `franchise_portal`, `spare_parts`. `tests/unit/` (pure). | R1–R7 |
| Environments | `CONFIRM_PROD` in the one-liner; the startup-command fact recorded in R0; "the owner migrates prod to an explicit revision before each publish". | R0 |
| Geography | Where the coordinates came from (Task 00 §3.1) and 19,195 / 19,496. | R0 |
| New short "Unit tests" | `pytest` is pure; the conftest guard; `requirements-dev.txt` never ships; database behaviour is `verify.py` + acceptance criteria. | R0 |
| Database cleanup | "What survives": franchise logins follow their company's memberships like any user; the six new tables are per-company. | R7 |
| Google Play review sign-in | "The reviewer technician belongs to the review company's **home** franchisee and is a **freelancer**; `seed_play_review` refuses otherwise, and the review company never gets a second franchisee." | R4 |
| Commands | `python -m pytest`. | R0 |

### 6.3 `adminWeb/AGENTS.md`

| Where | Change | Rel. |
|---|---|---|
| Hard rule **0a** | Retitle "**Four surfaces, and neither a vendor nor a franchise user may reach the ops one.**" Text: `routes.tsx` has four top-level branches — `/companies` (superadmin), `/portal/*` (vendor), `/franchise/*` (franchise roles), everything else (staff). `landingPath()` ranks them **superadmin → franchise → vendor → ops** through `lib/surface.ts`'s `surfaceOf`; `SHELL_PATHS` replaces every `portal ? … : …` ternary. `RequireFranchiseFeature` denies by default like `RequirePortalFeature` — `FranchiseNavItem.feature` required. ⚠ `/franchisees` (staff screen) vs `/franchise` (portal): both feature matchers append `/` before prefix-matching; never match `"/franchise"` without it. The session persists a `franchise` flag (store version 7). | R3 |
| New section **"The workspace adapter — one set of screens, two workspaces"** | Task 09 §5.2: `WorkspaceApi` (`paths`, `features`, `technicians`, `redemptions`, `ledger`), `OPS_WORKSPACE` built from the existing services, `FRANCHISE_WORKSPACE` from `services/franchise.ts`; `FranchiseShell` provides it, `AppShell` does not — **outside the provider is ops, which is the safety property**; a new portal-only page must sit under `FranchiseShell`; hooks never branch on the workspace (both queries with `enabled`); staff-only queries are gated off in the franchise workspace (hard rule 9 would toast every 403); query keys deliberately unchanged (cache cleared on sign-in, one surface per session). The three rejected alternatives in one line each. | R3 |
| Project structure | `pages/franchisees/`, `components/franchisees/`, `pages/franchise/`, `components/franchise/` (`franchiseNav.ts`), `lib/surface.ts`, `services/workspace.ts`, `services/franchise.ts`, `hooks/useWorkspace.ts`, `components/allowances/`, `components/parts/`. | R3 / R5 / R7 |
| Brand | The franchise rail: the company's tile and name (`useBrand()`), the franchisee's name as the second line; file names company slug then franchisee slug; `BRAND_NAME` is wrong there. | R3 |
| Performance plan | "**`leaflet` 1.9.4 + `react-leaflet` 5.0.0** were audited in for the base-location pin: ≈ 45 kB gzipped, loaded only in the lazy `BaseLocationMap` chunk, `leaflet.css` imported inside it, `divIcon` instead of the default marker PNGs. OpenStreetMap tile policy: visible attribution, default Referer, no prefetch; move to a keyed provider if maps ever become routine." | R5 |
| Domain facts | Ledger kinds: `KIND_LABEL`/`POOL_SIGN` fall back for an unknown kind (label = raw kind, sign +1) — a `Record` index on a wire string is how the pool screen printed NaN; `Awaiting Part` badge token `--status-awaiting-part` (warn); `isReschedulable` ≠ `isTimeChoosable` — never widen `TIME_CHOOSABLE_STATUSES`; the dashboard tile and its list both send `Assigned,In Progress,Awaiting Part`; `canManage`/`canAct`/`canReverse` come from the server — never recompute F8 in the browser; the travel preview is a mirror of the server's arithmetic and changes in the same PR. | R4–R7 |
| Commands | `npm test`. | R0 |

### 6.4 `mobileapp/.claude/skills/reliance-greentech-tech-app/SKILL.md`

| Where | Change | Rel. |
|---|---|---|
| §2 intro | "18 screens in the prototype, 24 now" → 27; additions: base location (+ map) and the part picker. A third ⚠ paragraph: "**Base location, spare parts and allowances are NOT IN THE PROTOTYPE** — copy approved with the franchisee programme (Tasks 07, 14, 15 sign-offs), same two consequences as Reschedule." | R5 / R8 |
| §2 table | `(app)/base-location` **NEW** — where do you start from (pincode / GPS / map); `(app)/base-location/map` **NEW** — OpenStreetMap pin in a WebView; `(app)/job/[id]/parts` **NEW** — pick a spare part or *Other*. | R5 / R8 |
| "The two onboarding paths" | Invite path becomes `R1 -> R1b -> R2 -> register/verify -> base -> Home`; the base step runs after the account exists and can be skipped (Home card then). §3 R2 note: "**StepDots is now 5**" — a change to an approved visual; lead any copy request with it. | R5 |
| §3 "7 — Job detail" | Allowances card (frozen travel km/₹ and speed terms, "time waiting for a part doesn't count", the no-base line + *Set base location*); Spare parts card; *Need a spare part*; *Awaiting part* banner with Complete disabled (*Waiting for parts*), Reschedule allowed, no Cancel; employees see *In salary* in place of the payout. | R4 / R8 |
| §3 "15 — Earnings" | Ledger kinds: `Travel allowance` (green, navigation), `Speed reward` (amber), `Speed penalty` (red, debit); an unknown kind renders neutral, unsigned, with the server's title; tiles unchanged with *incl. ₹X travel* / *incl. ₹X speed* lines — never added to the figure. | R4 / R8 |
| §3 "Redeem" | Employee card *You're an employee* — no amount, no Redeem/Add UPI ID; Redemptions link stays; an open redemption from freelancer days stays confirmable. | R4 |
| §4 Domain model | `serverStatus` alongside `JobStatus`; **every enum off the wire goes through a total function with a fallback** (`toTransactionKind`, `toJobStatus`), never a `Record` index (prototype keys `constructor`/`__proto__` included); `technicianType` from the session (absent = freelancer). | R4 |
| §4 Status badge rules | New row after *completed*: `Awaiting Part` → `Awaiting part` / `statusAwaitingPart` (amber), shown even when the slot has closed; unknown status → *In progress* with the "update the app" note on Job detail. | R4 |
| New §4 subsection **"Native modules"** | `react-native-webview@13.15.0` — the one module added for the franchisee programme (X3, flagged per root AGENTS.md): in Expo Go for SDK 54, needs a new EAS build for dev-client/production, no config plugin; Leaflet loaded from unpkg inside the page (a runtime dependency of the map, not of the app); `postMessage` is untrusted input → `parseMapMessage`; `source.html` never changes after mount; OSM policy (attribution, `applicationNameForUserAgent`, Referer, no prefetch). No `react-native-maps`. | R5 |
| §6 Mock data | Jobs, pool and earnings are real now; this paragraph is stale already — replace "Still mock: jobs, the pool, earnings…" with what is still mocked (AI review). | R8 |

### 6.5 `.github/DEPLOYMENT.md`

Record the R0 finding (whether each App Service's startup command migrates); replace "no pytest configured"
with the three test steps Task 00 adds; add one line: "a production release is a tagged merge of `dev` into
`main`; during a gated programme `main` holds only what has passed its gate" (W5). R0.

---

## 7. Unit tests, acceptance criteria and rollback

### 7.1 Unit tests

**None new** — this task writes no code. The full suite after R8, all green, run locally and in `pr-check.yml`:

```bash
cd api && pip install -r requirements-dev.txt && python -m pytest            # pure, no database (X1)
cd api && python -c "import app.main" && python -m app.scripts.cleanup_db --check
cd adminWeb && npm ci && npm run lint && npm run typecheck && npm test && npm run build
cd mobileapp && npm ci && npm run lint && npm run typecheck && npm test && npm run doctor
```

Expected test files (from the task docs; a missing one is a missing test, not a rename):
**api/tests/unit** — `test_coordinates`, `test_no_db_guard` (00); `test_franchise_core`, `test_franchisee_models`,
`test_franchise_tenancy_lists`, `test_ledger_entry`, `test_migration_3b7e1f0a9c41` (01); `test_roles`,
`test_franchise_guards`, `test_franchise_scope`, `test_franchise_visibility_sql`, `test_rbac_manageable`,
`test_users_role_refusal`, `test_ticket_ws_franchise`, `test_migration_5d2a8c6e0b13` (02); `test_pincode_ranges`,
`test_carve_out`, `test_company_code` (03); `test_franchise_routing`, `test_realtime_payloads` (04); `test_audience`,
`test_franchise_money`, `test_ledger_pool` (05); `test_employment`, `test_statements` (06); `test_travel`,
`test_accept_snapshot`, `test_base_location` (10); `test_speed` (11); `test_spare_parts` (12).
**adminWeb** — 00's harness proof, 02's `useCompanyUsers.test.ts`, 08's `pincodeRanges`/`FranchiseeTable`/`TechTable`,
09's `surface`/`session`/`useWorkspace`/`franchiseNav`/`ledgerAdapters`/`statements`/`routeFor`/`nav`/`navMatch`,
13's `ledgerKinds`/`travelPreview`/`speedRows`/`speedSchema`/`pickTree`/`baseLocation`/`partStatus`/`forceCloseSchema`.
**mobileapp** — 00's `coordinates`; 07's `ledger`/`kindStyle`/`stage`/`jobBadge`/`technicianType`/`refusals`/
`LedgerRow`/`serverLabels`; 14's `pincode`/`coords`/`mapHtml`/`mapMessage`/`baseSummary`/`registration.steps`;
15's `partStatus`/`picker`/`allowances`/`breakdown`/`pushRoute`.

### 7.2 Acceptance criteria — end-to-end smoke on dev, after R8

On **RelianceDB** with the local API (one listener on :8000 — root AGENTS.md), the local console
(`npm run dev`, `.env.local` → local API) and a dev-client build of the R8 app. Console logins: only
`@seed.example.com` addresses or `testing.srikanthjuturi@gmail.com` (ACS allowlist); a failed send returns the
temporary password. Technicians: unreachable `+911…` numbers, OTP from `devCode`. Customer phone: only
`6301815418` or `9398475448`. Never write to QA's *Testing Company*. The worked example of index §1, with
Acme's names:

**Setup**

1. **Given** the superadmin, **when** they create *Acme Appliances* (admin `admin.acme@seed.example.com`),
   **then** `franchisees` holds one row for it — name *Acme Appliances*, code `HOME`, internal, home — and
   `franchisee_travel_rules` two rows for it at ₹0. (The index calls it *Acme Home*; Task 01 decided the home
   carries the company's own name — this criterion checks the decision.)
2. **Given** Acme's Admin, **when** they create a vendor (login `vendor.acme@seed.example.com`), the category path
   *Electronics → Washing Machine → Front Load* (leaf), an approved model *FL-7* priced ₹450 to the technician,
   parts *Drain pump* and *Door lock* on *Washing Machine* and *Control board FL-7* on the model, and three
   technicians directly — **Ravi** (500032, 500033, 500034), **Hema** (500032, 500099), **Meena** (500032, 500035) —
   all certified on *Washing Machine*, **then** all three are on the home, `freelancer`.
3. **Given** the vendor raises ticket **K1** at 500033 (unassigned) and **K2** at 500034, and Ravi accepts K2,
   **when** the Admin creates *Acme Secunderabad* (internal, `500003-500015, 500025`) and *SkyFix Services*
   (external, admin `anil.skyfix@seed.example.com`) and saves SkyFix's ranges `500030-500040` with
   `dryRun=true`, **then** the preview names Ravi and Meena as moving, Hema as losing 500032, K1 as re-stamped,
   K2 as kept — and nothing is written.
4. **When** applied, **then** Ravi and Meena are SkyFix; Hema keeps only 500099 and stays home; K1's
   `franchisee_id` is SkyFix with a `franchisee_changed` event; K2 is still home, still Ravi's; a
   `technician_moved` bell reached the NH. Saving Secunderabad with `500030` → 409 `FRANCHISEE_PINCODE_TAKEN`
   naming *500030 — SkyFix Services*.
5. **Given** Anil signs in with the temporary password, **then** he lands on `/franchise/technicians` under
   Acme's tile with *SkyFix Services* as the second line; pasting `/technicians` sends him back to `/franchise`.
   He makes **Meena** an `employee` (allowed: no balance, no open jobs), sets SkyFix's freelancer travel rules to
   free 20 km, step 2 km, ₹10 per step, 130 %, max ₹300 and the employee rules to free 30 km with the same rate,
   adds the speed rule *freelancer × Washing Machine: within 12 h → ₹200, after 24 h → −₹150*, creates facility
   admin **Fatima**, who creates facility operator **Om**. **Anil is SkyFix's only active admin**, so the Admin's
   `POST /franchisees/{SkyFix}/admins/{Anil}/deactivate` → 409 `FRANCHISEE_LAST_ADMIN` (owner ruling 2026-10-15); after a
   second SkyFix admin is added it succeeds. The home franchisee has no facility user yet, so a home technician's
   `POST /jobs/{id}/part-requests` → 409 `NO_FACILITY` and `partsEnabled = false`; the Admin then adds a home facility
   admin through `POST /spare-parts/home-facility-users` and the same request succeeds.
6. **Given** Ravi in the app, **when** he opens the *Set your base location* card and drops a map pin, **then**
   `PUT /technicians/me/base-location` stores `source = 'map'`; Meena's base is set by Anil from the console pin
   (`source = 'map'`, *Set by your manager* in her app). Hema has no base. **Ravi's base is visible (owner ruling 2026-10-15,
   R9):** Anil's technician list and Ravi's profile show the *Map* chip and *Set by the technician*; no approval step
   exists; after Anil corrects Ravi's base the chip and the "set by" line change and no accepted job's snapshot does.

**Routing and accept**

7. **Given** the vendor raises **T** at 500032, one at 500010 and one at 500099, **then** they are stamped SkyFix,
   Secunderabad and home. **And** T is in Ravi's and Meena's pool (Meena's card reads *In salary*), not in
   Hema's — even after a stale `technician_pincodes` row for Hema at 500032 is inserted by hand (delete it after).
8. **Given** the customer picks a slot for T from the link, **when** Ravi accepts, **then**
   `accept_snapshot` has `franchiseeId` = SkyFix, `technicianType = 'freelancer'`, `travel.basePoint.source =
   'map'`, `travel.customerPoint.source` = `pincode` (or `ticket` if the vendor picked an address),
   `travel.amountPaise = min(30000, floor((km − 20) / 2) × 1000)` for the snapshot's own `km =
   round(straightKm × 1.3, 1)` (for the index's 28.1 km that is ₹40), and `speed.matchedOn = 'node'`,
   `rewardWithinHours = 12`.
9. **When** Anil then changes the travel rate to ₹20 and Ravi moves his base, **then** T's snapshot is unchanged.

**Spare parts**

10. **Given** Ravi starts T (four proofs), **when** he requests *Drain pump* with a note, **then** T is
    `Awaiting Part` with a `part_requested` event, Fatima and Om have a `part_requested` bell, and Ravi's
    *Complete* answers 409 `PARTS_PENDING` (translated). **When** he also requests *Other: inlet hose clamp*,
    **then** a second request exists and a repeat of *Drain pump* returns the first (no third row).
11. **When** Om rejects the hose clamp with a reason, approves the drain pump and logs *New part issued to
    technician*, **then** the events read `part_rejected`, `part_approved`, `part_issued`, Ravi receives the
    pushes (as `type: 'job'`), and T returns to `In Progress` (every request issued or rejected). **Owner ruling
    2026-10-15 (R2):** on a second job, after Om **approves** a request, a later `POST …/reject` with a reason answers 200,
    `rejectedAfterApproval = true`, a `part.rejected_after_approval` push and — with nothing else open — the job returns to
    `In Progress`; the same call on an `issued` request → 409 `PART_REQUEST_BAD_STATE`.
12. **When** Ravi completes T and, afterwards, Om logs *Old part received back* with a note and photo, **then**
    T is `Awaiting Customer`, the drain-pump request is `returned` (allowed after completion), and its photo is a
    blob name under `attachment/<Acme id>/`.

**Closure and money**

13. **Given** T's slot starts after the accept and T's events are backdated (before the customer answers) so that
    **slot start → completed** is 11 h with 2 h in `Awaiting Part` (owner ruling 2026-10-15, R1: the clock starts at the
    later of the accept and the slot start — a separate job accepted Monday for a Thursday slot and completed Thursday
    is measured from Thursday), **when** the customer confirms from the feedback link, **then**
    `SELECT kind, amount_paise, franchisee_id, technician_type FROM ledger_entries WHERE ticket_id = T` returns
    exactly `payout 45000`, `travel <snapshot amount>` and `speed_reward 20000`, each SkyFix and `freelancer`;
    a `speed_settled` event notes *Finished in 9.0 working hours* with no rupee amount; SkyFix's pool balance
    fell by 20000 and the home pool did not move; Ravi's Earnings shows *incl. ₹X travel* and *incl. ₹200 speed*
    and `net = earned + bonuses − penalties`.
14. **Given** Acme's Area Manager for Telangana, **then** he can reschedule and force-close another SkyFix
    ticket (200), sees T's travel amount **and** its `speed` block (owner ruling 2026-10-15, R8) but no base coordinates and no pool, `PUT
    /technicians/{ravi}` → 403 *Managed by SkyFix Services*, and `GET /ledger?franchiseeId=<SkyFix>` → 403.
15. **Given** a second Ravi job closed at 30 working hours, **then** a `speed_penalty 15000` row exists and counts
    in `charged_this_month`; **when** Anil reverses it from the portal's pool screen with a reason, **then** a
    `reversal` row carries SkyFix's id, a second reversal → 409 `PENALTY_ALREADY_REVERSED`, and Ravi's Earnings
    no longer subtracts it.

**Redemption and the employee**

16. **When** Ravi redeems, **then** `redemptions.franchisee_id` is SkyFix and the bell is `audience =
    'franchisee_admin'`; the NH's `POST /redemptions/{id}/claim` → 404 and her detail shows `canAct: false`;
    Anil claims with a screenshot from `/franchise/redemptions/{id}`; Ravi taps *I received it* → `confirmed_at`
    set.
17. **Given** Meena accepts, completes and the customer confirms a SkyFix job, **then** there is **no** `payout`
    row, there is a `travel` row (employee rules) with `technician_type = 'employee'`; `POST /redemptions/me` →
    409 `EMPLOYEE_CANNOT_REDEEM` and her Earnings shows the employee card.
18. **When** Anil downloads Meena's statement for this month, **then** the CSV starts with a BOM, is named
    `statement-…-<code>-YYYY-MM.csv`, and its credit and debit totals equal Task 06 §7.10's SQL for
    `franchisee_id = SkyFix`, `technician_type = 'employee'`, `kind <> 'payout'`, IST month bounds.
19. **Given** an employee job force-closed by the AM, **then** the form shows no payout box and the travel field
    pre-filled with the frozen amount (editable, capped at the frozen max); no `payout`, no `speed_*` row.

**Walls and scripts**

20. Secunderabad's admin on Ravi's technician, redemption and ledger ids → 404; any SkyFix id from another
    company's franchise login → 404; Om on `GET /franchise/technicians` → 403.
21. `python -m app.scripts.audit_tenancy` → exit 0 with the 18 new links ok; `python -m app.scripts.cleanup_db
    --check` → all tables classified; `python -m app.scripts.seed_synthetic --tickets 50` → finishes with no
    verify problems, every §5.2 check having read rows (a franchisee, employees, travel, speed and part rows
    exist in the seeded company); `python -m app.scripts.seed_play_review` → the reviewer is home, freelancer,
    with a base, and the company has no second franchisee.
22. **Given** SkyFix's ranges cleared (`""`), **then** Ravi and Meena return to home, open unassigned SkyFix
    tickets are re-stamped home, and SkyFix can then be deactivated (its logins stop refreshing) — **even though
    Anil was its last admin** (owner ruling 2026-10-15, R3: franchisee deactivation is unaffected).

### 7.3 Rollback notes per release

There is no automated rollback (`.github/DEPLOYMENT.md`): an API or console rollback is re-running the deploy
workflow against the previous release tag. Every downgrade below is the owner's to run, refuses in words when
it would lose a fact, and should be rehearsed on dev first.

| Release | Can the previous API run on the new schema? | Rollback | When it stops being clean |
|---|---|---|---|
| R0 | yes | Revert CI/harness commits. `f9c2d8a3e17b` is the owner's and not rolled back. | — |
| R1 | **No** — five NOT NULL `franchisee_id` columns. | Downgrade `5d2a8c6e0b13` → `3b7e1f0a9c41` → `f9c2d8a3e17b`, **then** redeploy the R0 API. | The first franchise login (02 refuses), non-home franchisee, `franchisee_pincodes` row, employee, `franchisee_changed` event or `technician_moved` bell (01 refuses). After that: fix forward. |
| R2 | **No** — `ledger_entries.technician_type` NOT NULL, no default. | Downgrade to `5d2a8c6e0b13`, then redeploy R1. | Any employee ledger row, or a UPI change addressed to a franchisee admin (refused); franchisee-admin bells are deleted, not kept. |
| R3 | n/a (console only) | Redeploy the console from the R2 tag. **08 and 09 roll back together** — never 09 alone. | Franchise logins created meanwhile keep working through the API; they simply cannot sign in to a portal until it returns. |
| R4 | n/a | A Play build cannot be withdrawn: halt the rollout, ship a fix build. The console forward-compat commit is never rolled back once R6/R7 are live. | — |
| R5 | **Yes** (additive). | Redeploy R4's API; schema stays. Softer: rates to ₹0. Task 14's build PUTs a base-location route the old API lacks — do not roll the API back once that build is out (the step can be skipped, the refusal is a line, but every save fails). | First `travel` row (downgrade refuses). |
| R6 | **Yes.** | Redeploy R5's API; softer: delete the speed rows (empty = off). | First `speed_*` row or its reversal (refuses). |
| R7 | Mostly — but the old API has no way out of `Awaiting Part` except force-close. | Redeploy R6's API only while no ticket waits; force-close any that do. | First `spare_part_requests` row or ticket in `Awaiting Part` (refuses). |
| R8 | n/a | Halt the Play rollout; Task 15's buttons need R7's server, so R7 must stay. | — |

---

## 8. Out of scope / traps

**Out of scope:** any feature code; money between an external franchisee and the company (F11); a pincode-centre
correction screen (G2); server-side counting of `X-App-Compat` (not built by any task — an owner decision
below); automated deploy rollback; rotating the exposed publish profiles (`.github/DEPLOYMENT.md`'s locked
decision); WhatsApp templates in other languages.

**Traps**

1. **The production startup command may migrate on its own.** `.github/DEPLOYMENT.md` says both App Services
   start with `python -m alembic upgrade head && gunicorn …`; the `publish-api` skill shows gunicorn only. If the
   former is live, publishing `main` runs `upgrade head` against RelianceProdDB at container start — a no-op when
   the owner has already migrated, and a down API (gunicorn never starts) if a migration fails there. Confirm in
   R0, and keep W4/W5: the owner migrates to the release's revision first, and `main` never carries a later one.
2. **Every CHECK rewrite copies the live definition first.** Tasks 11 and 12 carry `_assert_check_is` guards; before committing either migration, compare its "before" list with `pg_get_constraintdef` at the previous revision (the reconciled docs already list `speed_settled`, `franchisee_changed`, `technician_moved`).
3. **`cleanup_db` classification travels with each table** — Task 10 adds `franchisee_travel_rules`, Task 11 `franchisee_speed_rules`, Task 12 its two tables, each in its own commit, or Task 01's classification test fails CI.
4. **Naming reminders:** the home franchisee is named after the company (code `HOME`); the carve-out bell is `technician_moved` (16 characters).
5. **R1 and R2 are migrate-then-publish-in-the-same-sitting.** Both add a NOT NULL column the previous API never
   writes. Out of hours, back to back, the owner and the publisher on the same call.
6. **"Live on Play" is not "on the phones".** The in-app update is FLEXIBLE and never forced, and there is no OTA
   (`expo-updates` is absent). R4's gate OUT is the adoption figure, not the release date.
7. **Every Play submission re-seeds the reviewer first** (R4, R5, R8). A preview APK never tests the update
   sheet; use the internal track.
8. **Do not convert anyone to employee on production before R4's gate** (W8). (The earlier agreement not to configure
   a speed rule before the clock question was answered is **retired** — owner ruling 2026-10-15, R1.) An agreement,
   not code.
9. **`dev-deploy.yml` deploys on every push to `dev`.** Run each migration's round trip locally *before* merging;
   the dev App Service may migrate RelianceDB on restart, after which a broken downgrade is found on shared data.
10. **Counts in prose go stale.** Do not write "eleven statuses", "27 screens" or feature/role counts into
    api/AGENTS.md ("measure, do not do arithmetic"). The root AGENTS.md "nine ticket statuses" is the example.
11. **The blob containers are shared** between dev and prod; the part-return photos and force-close attachments
    land in `installflow-proof` like every other private file. Nothing here cleans them.
12. **`verify.py` passes on an empty set.** Without §5.1's seed changes, every new check reads zero rows and
    proves nothing — W11.

---

## Owner decisions still open

Gathered from index §6/§6a and every task doc's items flagged for the owner. Each has a written default the
code follows until the owner says otherwise.

**Settled on 2026-10-15 and no longer open** (applied everywhere; index §6c lists them): the speed-clock start
(**R1**), cancelling an approved part request (**R2**), refusing to deactivate a non-home franchisee's last admin
(**R3**), no Admin/NH parts fallback for the home franchisee (**R4**), the type-change rules (**R5**),
`vendorPricePaise` hidden from franchise principals (**R6**), no speed money on force-close (**R7**), staff seeing
both travel and speed on any ticket in scope (**R8**), self-set base abuse — visible, no approval, no cooldown
(**R9**) and no travel estimate on the offer (**R10**).

1. **A second part while the job already waits** — allowed (Task 12 D1, written yes) vs P2's literal "only while
   `In Progress`".
2. **Facility admin and operator have the same part powers**, the admin also manages operators (P6); **a
   franchisee admin sees its franchisee's tickets read-only** (F13) and **franchise users see tickets by ownership**,
   never by territory (index §6, Task 02).
3. **Carve-out details** — a technician left with zero coverage moves instead of keeping none (F6); `Escalated`
   with no technician is re-stamped too, beyond F6's list (Task 03); no push to a moved technician (Task 03).
4. **Ledger and redemption `franchisee_id` = the technician's at write time**, not the ticket's (index §6); a
   reversal copies the penalty's (Task 01).
5. **Home franchisee keeps today's technician/money rules for existing roles** (F8); its name is the company's,
   code `HOME` (Task 01).
6. **"Last active" not "Last sign-in"** for franchise admins (derived from refresh tokens — Task 03 → 08).
7. **Mobile ≥ 90 % adoption** as part of gate (a) (Task 07 §8; index §6a adopted it) — and whether to keep the
   `X-App-Compat` header, which needs a server-side count nobody has built to be useful (Task 07 §5.15).
8. **Employee payout shown as *In salary*** on pool, offer and job detail, by the technician's current type
   (Task 07 §5.9).
9. **Minor items still on their written defaults** — `PINCODE_OUTSIDE_FRANCHISEE` is 422 everywhere (the owner may
   prefer 400 for the base-location case); an employee's force-close payout is **ignored, not refused** (Task 06
   §4.3); **reversals land in the month they are written** on statements (Task 06 §4.9); a per-franchisee summary
   CSV is not built (Task 06). *(Settled by the consistency pass and no longer open: register-time `baseLocation`
   dropped — Task 14 uses the Profile PUT; facility users get a reissue-password route — Tasks 12/13.)*
10. **Deactivating a franchisee's last facility user while requests are open** — not refused (Task 12 §8); the open
    requests wait for a reactivation, or the job is force-closed. R3's last-admin refusal covers franchisee admins only.
11. **Pincode-centre correction screen** (G2; e.g. 500032 ~40 km off) — a possible later task; it must re-copy
    `base_source = 'pincode'` bases and never touch an `accept_snapshot` (Task 10 trap 8).
12. **Existing bug, not in scope:** after a customer answers "not done", a second customer confirmation is
    impossible, so the job can only be force-closed (index §6, Task 10 trap 6). Worth its own ticket.
