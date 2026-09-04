# Reliance GreenTech Installation API

FastAPI + PostgreSQL behind the ops console (`adminWeb/`) and the technician app
(`mobileapp/`). Read the root `AGENTS.md` first for the business flow and the domain facts.

Live today: auth (password + technician OTP + change-password), companies, users & roles,
territory, **the geography master and its spreadsheet importer**, the product master, technician
onboarding in both modes, **vendor accounts and their sub-users**, and tickets (vendor intake,
the list, and the customer's own slot confirmation).
The **job pool** is real too: a confirmed ticket (`status = 'New'`) is offered through
`/jobs/pool` to the technicians whose `technician_pincodes` and `technician_subcategories`
match it, and taken by a guarded UPDATE whose rowcount settles first-accept-wins.
The **daily job cap** is enforced, in `core/coverage.py` and nowhere else: one predicate used by
`pool_query`, by the guarded UPDATE in `accept`, by push targeting and by the console's `bwUsed`,
so all four agree by construction. It counts by **SLOT date in IST** — not by when the job was
accepted, and not from `assigned` events. Five jobs taken tonight for Friday exhaust *Friday*.
`Closed` and `Force-Closed` still count; only `Cancelled` is exempt.

**Escalation, cancellation and the penalty pool are live**, which is §7 end to end. A job nobody
accepts inside its company's window moves to `Escalated` — out of `pool_query` — and a manager
either assigns somebody or funds a bonus that re-publishes it. A technician can give a job back;
the slot never moves, the band is charged, and inside the window it escalates immediately.
`ledger_entries` is the pool both directions run through: `balance = penalties − bonuses`. A
no-show is detected by a sweep that charges NOTHING and confirmed by a person.

Every operating number is per company in `company_rules`, edited on Configuration → Rules Config.
The band BOUNDARIES are not, and belong in `core/rules.py`: an amount is policy, but where one
band ends is a fact about the clock.

**The DEFAULTS live in code, not in seed data.** `rules.DEFAULTS` is the source, and a company gets
its row stamped from it inside `create_company`'s own transaction; `load_rules` recreates a missing
one on the next read. So `company_rules` holds a company's OVERRIDES — emptying the table resets
rules, it does not destroy them, which is what makes it safe to clear with the tenant data it
belongs to. The reason the self-heal exists: every sweep but `sweep_no_shows` INNER JOINs this
table, so a company without a row silently stops being swept, and a missing escalation is
invisible in exactly the way a missing row is.

`GET /tickets/escalations` is **paginated but never pagered** — the console loads on scroll, so
every row stays reachable. Its ordering does two jobs at once and is one expression so the API and
the screen's headings cannot disagree: live rows before missed ones (page one is therefore the half
that can still be rescued), then **live ascending and missed DESCENDING** — soonest-at-risk first
among the live, most-recent-failure first among the missed. Both halves sort ascending on a single
signed-epoch key, because ordering `slot_start` twice in opposite directions would need two queries
and paging could not span them. It takes `search` (the ticket board's own predicate), `half`, and
an IST `slotFrom`/`slotTo` range on the SLOT — the day the work was promised, not the day the
ticket was raised.

**Job payouts are live.** `product_models` carries `technician_payout_paise` and
`vendor_price_paise` (both NOT NULL — an unpriced model is not a state, so intake needs no check
for one), `tickets` stamps both at intake, and closure writes a third `LEDGER_KINDS` value,
`payout`. Two writers, and they shipped with the kind (hard rule 8): `feedback_service` on a
customer-confirmed closure credits the full amount, `force_close_ticket` credits what the manager
entered, clamped to the ticket's price and writing no row at zero.

Three things about it are load-bearing:

- **The masking is by principal, in the serializer.** `masters.get_tree` and `tickets._hydrate`
  both null `technicianPayoutPaise` for a vendor — `_hydrate` takes `principal` for that one
  reason, so the decision lives in one place rather than at its four call sites. The jobs slice
  needs no such branch: `JobOfferOut` has no vendor-price field, and must never grow one.
- **A payout is not pool money.** `core.ledger.pool` and `features/ledger._entries_query` both
  restrict to `POOL_KINDS`; `features/earnings` reads the same table unfiltered, because the
  technician's own list is all three kinds. Left unfiltered, the console's pool screen would list
  wages under a balance they are not part of.
- **`net = earned + bonuses − penalties`**, in one grouped query in `earnings.summary`, so the
  three tiles and the hero figure cannot come from different reads. It may be negative.

Still to come: **AI review**, the **dashboard**, and the **redeem-cash flow** — a technician's
`upi_id` is collected (console add/edit, the joining flow, and `PATCH /technicians/me/payout-account`)
but nothing spends against it yet.

Two things nothing clears yet, both deliberate and both needing a product decision rather than
code: an escalated job whose slot has PASSED stays in the queue for ever (re-slotting means asking
the customer for another time), and the vendor is never told their customer's slot is at risk.

---

## Hard rules

### 1. This is multi-tenant. A company's data never touches another company's.

The single most important invariant in the codebase, and the easiest to break by accident.

**Every tenant table carries `company_id`.** Not "can be reached through a join that has one" —
carries it. The only tables without one are listed, with reasons, in
`app/scripts/audit_tenancy.py`; adding to that list should take an argument.

**Every parent/child link inside tenant data is a COMPOSITE foreign key** on
`(company_id, parent_id)`, pointing at a `UNIQUE (company_id, id)` on the parent. A plain
`parent_id` FK lets a child in company A reference a parent in company B — the database will
store it happily, and only an application check stands in the way. `memberships.manager_id` has
used this pattern since the schema was written; everything else now matches it.

```python
__table_args__ = (
    UniqueConstraint("company_id", "id", name="uq_parent_company_id_id"),   # on the PARENT
    ForeignKeyConstraint(                                                    # on the CHILD
        ["company_id", "parent_id"],
        ["parent.company_id", "parent.id"],
        name="fk_child_company_parent",
        ondelete="CASCADE",
    ),
)
```

**Every read and every write filters on `principal.company_id`.** Load-by-id included: a caller
who guesses another company's UUID must get **404, not 403** — a 403 confirms the row exists.

**Never trust a client-supplied id.** Resolve it through a scoped loader (`_load_subcategory`,
`_load`, `_load_invite`) that already has `company_id` in its WHERE clause. An id that arrives in
a request body is an assertion, not a fact.

**Run the audit after ANY schema change:**

```bash
python -m app.scripts.audit_tenancy    # exit 1 if isolation is broken
```

It checks all three of the above and reports rows that already disagree with their parent. It
found a real gap the day it was written.

Two families that are NOT tenant data, so they have no `company_id`: the geography master
(`regions`, `states`, `districts`, `pincodes`, `pincode_districts` — India is the same shape for
every company) and the `roles` / `features` catalogues (global, with per-company overrides in
`company_role_features`). `users` is global too, because one person may work for
several companies — the `memberships` row is the tenant link.

#### The spreadsheet is the only source. There are no overrides.

`RequirementDocs/Reliance Green Tech Pin Code.xlsx` is what the importer reads, and nothing
else outranks it. An earlier version carried researched corrections in a `pincode_overrides`
module; they were deleted because an override outranks the file — so fixing the file stopped
fixing the master, and you could not tell from the sheet what the master would end up holding.

**To change or add a pincode: edit the sheet and upload it.** Corrections already applied are in
`RequirementDocs/apply-pincode-corrections.py` (declarative, re-runnable on a fresh vendor
export) and explained in `Pin Code corrections.md`.

Three importer rules that make that safe: it is **additive** (creates and updates what the file
names, never deletes what it omits, so a one-state sheet is fine on its own); a **tie is refused
by name** rather than guessed at; and **`#N/A` rows are dropped**, with any pincode that appears
on nothing else reported individually.

#### Three counting facts about the geography master

They are load-bearing: every one of them makes an obvious-looking sum wrong, and the console
states each out loud rather than hiding it.

- **District pincode counts do not sum to the state's total.** They are counted through
  `pincode_districts`, and **1,209** of the 19,496 pincodes sit in two to four districts, so each
  is counted once per district. Kerala is 1,428 pincodes and 1,450 across its districts. Never
  present that sum as a total.
- **Some pincodes may sit in no district at all.** None do today — the four that did were fixed
  in the sheet — but the sheet can always carry a blank district again, and anything that walks
  state → district → pincode drops them silently. `GET /geo/pincodes?noDistrict=true` is how you
  reach them, and it exists for exactly that reason.
- **Five district names belong to two states each** (Aurangabad, Balrampur, Bilaspur, Hamirpur,
  Pratapgarh). Filter by **id**, never by name — and anything listing pincodes above state level
  has to show the state, or the two Bilaspurs are indistinguishable.

**Every `/geo` read carries `CurrentPrincipal`, never `require_feature`.** `require_feature` is
built on `CompanyPrincipal`, which refuses a superadmin outright — a feature key here would lock
the superadmin out of the very screen that maintains this data. Only the importer and the
template are `require_superadmin`.

### 2. RBAC is enforced here, never in the UI.

Hiding a button is presentation. Every endpoint carries `require_feature("...")`, and territory
scoping (`_visible_technicians`, `territory_scope`) narrows what a Regional Head or Area Manager
can even see. Assume every client is hostile and every id is guessed.

**A key that already exists is not automatically the right key.** `jobs.close` means "close your
own job" and is seeded to `admin` and `technician`; force-closure needed the opposite audience, so
it got its own `jobs.force_close` rather than either locking out every manager the screen is for
or handing technicians an override that skips the customer. Where the decision spends money or
ends a job, pair the feature with `require_min_rank` — a feature grant is overridable per company
on Feature Access, and the floor is what makes "Area Manager and above" stick.

### 3. An area manager may only act inside their own states.

His territory is a set of STATES (`membership_states`, unique on `(company_id, state_id)` — a
state belongs to one manager), and he covers **every pincode inside them**, resolved from the
`pincodes` master. `check_pincodes_in_own_area` refuses anything outside with a 403 that **names
the offending pincodes** — a bare "forbidden" makes the manager guess. It runs on create, on
update, and on the coverage a technician they invited picks for themselves.

**Never materialise that coverage.** Uttar Pradesh alone holds 1,667 codes and `load_scopes` runs
on every page of the user list, so `Scope` carries states and never pincodes. Everything that has
to test a pincode against a territory uses the subqueries in `app/core/scope.py`
(`pincodes_in_states`, `pincodes_in_regions`) and lets Postgres do the filtering.

His REGION is derived from his states and written to `membership_regions` in the same
transaction, so every region-based query keeps working without learning about states. A client
that sends both a region and states for an area manager is refused — that is two answers to one
question.

### 4. Slices never import each other.

`app/api/router.py` is the one place that imports slice routers. If two slices need the same
logic, it moves to `app/core/` or `app/db/`. The one deliberate exception is documented where it
happens: `auth/otp_service.py` imports the technicians slice lazily, inside the function, because
a sign-in response has to carry the technician's profile.

### 5. Every response uses the envelope.

`ApiEnvelope` / `PaginatedEnvelope` from `app.core.schemas`, via `envelope()` / `paginated()`.
Both clients unwrap exactly that shape. Errors go through `app/core/errors.py`, which turns an
`IntegrityError` into the same 409 the pre-check would have given — never a 500, never raw SQL.

### 6. Migrations are hand-written, and the round trip is tested.

`--autogenerate` is a starting point, never the commit. Always:

```bash
python -m alembic upgrade head
python -m alembic downgrade <previous>
python -m alembic upgrade head      # the one people skip
```

**Audit columns go LAST.** `id`, `created_at`, `updated_at`, `created_by`, `updated_by`,
`deleted_at` sit at the end of every table, after the columns that say what the row *is*. You do
not have to remember this: the mixins in `app/db/mixins.py` use `declared_attr`, so they are
constructed after the model's own columns and sort behind them, and autogenerate follows the
models. Do not convert them back to plain `mapped_column` — that silently puts six columns of
bookkeeping in front of every table again.

**The schema is ONE migration.** Twenty-two were squashed into `9237a7143f8b_initial_schema.py`
when the audit columns were reordered — Postgres has no `ALTER TABLE … REORDER`, so the tables had
to be rebuilt, and history for a product that has not shipped was not worth keeping. Everything
since is a normal incremental migration on top.

**Constraints belong on the MODEL.** All seventeen CHECKs are declared in `__table_args__`, not
added by `op.create_check_constraint` in a migration, so the model is the whole truth about the
table and autogenerate can see it. Name them WITHOUT the `ck_<table>_` prefix — the naming
convention adds it, and passing it too produced `ck_tickets_ck_tickets_status`.

**A UNIQUE on a soft-deleted table is PARTIAL on `deleted_at IS NULL`.** Otherwise a hidden row
keeps its name forever: `uq_memberships_user_company` was total, so removing a technician from a
company — which soft-deletes the membership — made re-adding that person a permanent 409, caused
by a row invisible on every screen. Same for `uq_users_email_lower`. Fixed in `4c8f1b7d2e93`.

Two deliberate exceptions, both of which must stay TOTAL:

- `uq_tickets_company_code` — a ticket number is quoted in email and read out on the phone, so
  reuse is worse than a blocked insert.
- every `uq_<table>_company_id_id` — a partial index **cannot be a foreign key target**, and
  these are what all thirteen composite tenancy FKs point at.

**Every foreign key has a covering index.** Postgres does not create one for you, and the cost
shows up twice: a lookup by the child scans, and so does every DELETE of a parent, because the
database must prove no child still references it. `tickets(company_id, vendor_id)` was unindexed,
so deleting one vendor read every ticket in the database. `4c8f1b7d2e93` added the 26 that were
missing, including on fixed platform catalogues where the index buys nothing measurable — the rule
is worth more with no list of exceptions to argue about. A composite FK needs the columns **in
order**: an index on `company_id` alone does not serve `(company_id, vendor_id)`.

To find regressions, look for FK columns that are not a prefix of any index:

```sql
SELECT c.conrelid::regclass, c.conname FROM pg_constraint c
WHERE c.contype = 'f' AND NOT EXISTS (
  SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
    AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey);
```

The reverse also applies: **do not add an index a unique constraint already covers.**
`company_sequences` briefly had `ix_company_sequences_company_id` next to
`uq_company_sequence (company_id, name)`, which is the same prefix — pure write cost. The query
above counts a prefix as covered, so it will not ask you for one.

### 7. Only a vendor raises a ticket, and a vendor sees only its own.

Three roles now sign in: staff, technicians, and **vendors**. A vendor is an outside party, so two
rules govern it and neither is expressible with the tools the other roles use.

**`POST /tickets` carries `require_vendor_principal`, not just `require_feature("jobs.create")`.**
A feature grant is overridable per company through Feature Access, so on the feature alone
"vendor-only" lasts until an admin flips one row. `require_min_rank` cannot help either: a vendor
ranks BELOW every staff role, so a floor of `vendor` admits the entire company. Rank answers "who
outranks whom"; this needed "this role and no other". Test `principal.is_vendor` / `VENDOR_ROLES`,
never the number.

**Visibility is by OWNERSHIP for a vendor and by GEOGRAPHY for staff.** `tickets/service.scoped()`
is the one door both go through:

| role | sees |
|---|---|
| all-India staff | everything in the company |
| regional head / area manager | their territory's pincodes |
| `vendor` | `vendor_id = mine` — every ticket its people raised |
| `vendor_user` | `vendor_id = mine AND created_by = me` |

Applied on the list AND on fetch-by-id, so a guessed id reads 404. It fails closed: a portal role
whose membership names no vendor sees nothing.

**Anything a vendor can call must pin the vendor server-side.** `masters.view` is granted so the
intake form has a product tree, and `list_categories` and `/vendors/options` therefore substitute
the caller's own vendor for whatever was asked for. `_resolve_product` additionally checks
`model.vendor_id == vendor.id` — the composite FK constrains `(company_id, vendor_id)`, not
`(vendor, model)`, so nothing else says it.

⚠ **`audit_tenancy` cannot see this.** It proves a membership cannot name another COMPANY's vendor.
Whether one vendor can read another's tickets inside a company is an application invariant the
script has no way to check, and it will stay green either way.

### 8. Never ship a table nothing writes to.

`audit_logs` shipped in the initial schema with a model, indexes, a `company_id` and an exemption
in `audit_tenancy` — and not one line of code ever constructed a row. It was dropped in
`7b1e4a9c05d2` with 0 rows in every environment. An audit log that is silently empty is worse than
no audit log, because eventually somebody trusts it.

Same rule for columns. `technician_profiles.jobs_completed` and `jobs_cancelled` were
`NOT NULL DEFAULT 0` while nothing measured them, so every profile asserted a completed-job count
of exactly zero that had never been counted. They are nullable now: **null means "not measured",
which is a different claim from 0**, and both clients render it as `—`. This is the same rule as
"do not fake a number that has a real source", applied to the case where the source does not exist
yet.

When a table is genuinely needed before its writer lands, write the writer in the same change.
`ticket_events` declares only the four `kind` values the code writes TODAY; assignment and release
join the CHECK in the migration that adds the accept flow, not before.

Three things the autogenerated diff gets wrong every time:

- It wants to DROP the hand-written functional and partial indexes — `uq_companies_gst_lower`,
  `uq_users_email_lower`, `uq_memberships_user_company`, the `lower(name)` ones on the product
  master and vendors, `uq_tickets_slot_token`, the live-invite index. SQLAlchemy cannot express
  `lower(x)` or a `WHERE` clause in an `Index()`, so Alembic cannot see them and mistakes them for
  stale. **Delete those drops.** Recent Alembic sometimes emits a drop *and* an identical create —
  that is the same false positive wearing a different hat, and both halves go. They are created by
  `op.execute`, at the bottom of the initial migration or in `4c8f1b7d2e93`.
- Postgres caps identifiers at **63 characters** and SQLAlchemy silently rewrites longer ones with
  a hash suffix. When dropping an existing constraint, resolve its real name from `pg_constraint`
  rather than spelling it out.
- A parameter reused in a SELECT list and a WHERE needs `CAST(:param AS varchar)` on **both**
  sides, or Postgres raises `AmbiguousParameter`.

### 9. Money is integer paise. Phones are E.164.

Never a float, never a locale-formatted string in the database. `app/core/phone.py` normalises
every technician phone on the way in — it is their identity, and the partial unique index on
`users.phone` depends on one shape.

### 10. Sessions run with `autoflush=False`.

If you `session.add(...)` and then read those rows back before committing, **flush first**. This
already caused one real bug: a technician self-registered with three pincodes and landed on Home
showing none, because the response was built from a query that could not see the pending rows.

### 11. A stored instant is UTC. Anything a person reads is IST.

Every timestamp in the database is `timestamptz` in UTC, and India is the whole market — so any
value that reaches a human eye, or that a calendar day is reckoned from, has to be converted
first. `SLOT_TIMEZONE_OFFSET_MINUTES` (330) is the one definition; `core/coverage.ist_day_bounds`
and `tickets/service.clock` are the ways through it.

Both directions have already shipped a bug:

- **Formatting.** The slot reminder built its title as `f"{row.slot_start:%H:%M}"`, so a 2:00 PM
  appointment reached the technician's phone as *"starts at 08:30"* — five and a half hours wrong,
  on the one notification whose entire job is stopping somebody being late. Use `clock()`, which
  also gets the house 12-hour style right.
- **Comparing.** A bare calendar date has to become a UTC RANGE, never a cast — and the instant you
  hand `ist_day_bounds` must sit safely inside the intended day. `_ist_range` uses **noon**, not
  midnight: midnight-UTC on a date is 05:30 IST the same day, correct only by 5½ hours of luck,
  while a slot at 00:05 IST is 18:35 UTC the day BEFORE and drops out of any range built the naive
  way. A range also beats a cast because `timezone(text, timestamptz)` is STABLE, not IMMUTABLE, so
  Postgres will not index through it.

---

## Layout

```
app/
  api/router.py          the ONLY place slice routers are imported
  core/                  config, database, deps (Principal + guards), errors, features,
                         icons, phone, schemas (the envelope), scope, security,
                         sequences, sessions (revoking refresh tokens)
  db/                    base_class (naming convention), mixins, repository (territory_scope)
  emails/                templates/*.html and the renderer — the ONE place an email
                         BODY lives. Content only; the egress is integrations/.
                         Filled with string.Template ($name), NOT str.format, because
                         an email is mostly CSS braces. Every value is html-escaped.
  features/<slice>/      router.py · schemas.py · service.py — nothing else
                         NB `vendor_users` is its OWN slice, not part of `users`:
                         `users.*` gates the COMPANY's staff, and a vendor
                         holding it could read every manager in the tenant.
  integrations/          whatsapp.py, acs_email.py, otp_channel.py, blob.py — OUTBOUND,
                         and never raise on failure.
                         google_identity.py is the exception and says so: it is
                         INBOUND verification, where a bad token has exactly one
                         right outcome and there is no record to preserve.
  models/                one module per area; every model reachable from __init__
  scripts/               bootstrap, audit_tenancy, create_database, copy_geography
alembic/versions/        hand-written, with a prose docstring saying WHY
```

## Environments — two databases, one server

`sdlcaiserver.postgres.database.azure.com` hosts both:

| Database | Environment | Configured in | Who talks to it |
|---|---|---|---|
| `RelianceDB` | development | `.env` | a laptop running `python run.py` · `adminWeb`'s `.env.local` · Expo Go over the LAN |
| `RelianceProdDB` | production | `.env.production` | the deployed Azure App Service — and so the Netlify console and every installed mobile build |

**There is no environment switch in the code.** `Settings` always reads `.env` from the working
directory, `DATABASE_URL` is computed from that file's `POSTGRES_*` values, and `publish.py`
copies `.env.production` into the deployment zip **as `.env`**. The file is the switch.
`ENVIRONMENT` is a safety flag for OTP echo and the boot check — it selects nothing.

**A command run from `api/` hits DEVELOPMENT unless you say otherwise.** To target production for
one command, set the environment variable: pydantic-settings ranks it above the `.env` file, so
nothing is edited and there is nothing to forget to revert.

```powershell
$env:POSTGRES_DB='RelianceProdDB'; python -m alembic upgrade head
```

⚠ Editing `.env` to point at production "just for a minute" is how a laptop ends up migrating,
seeding or wiping the live database an hour later. Use the override.

Two consequences worth carrying:

- **A schema change has to be applied twice** — once to dev, once to prod — and prod must be
  migrated *before* the code that needs the new column is published, or the deployed API 500s
  against a schema it is ahead of.
- **The blob containers are still shared.** `installflow-media` and `installflow-proof` hold both
  environments' files. The database rows are separate; the files are one pool, so a dev-side blob
  cleanup can blank out production images.

### Standing up a database from empty

```bash
python -m app.scripts.create_database --name RelianceProdDB   # quotes the mixed-case identifier
POSTGRES_DB=RelianceProdDB python -m alembic upgrade head     # schema + roles/regions/features
POSTGRES_DB=RelianceProdDB python -m app.scripts.bootstrap    # the one superadmin user
python -m app.scripts.copy_geography --to RelianceProdDB      # 41,073 rows, ids preserved
POSTGRES_DB=RelianceProdDB python -m app.scripts.audit_tenancy
```

`upgrade head` seeds the global reference data itself — 8 roles, 5 regions, 26 features, 78 role
defaults — so there is nothing else to seed. Geography is the exception, because the tables are
created empty and normally filled from a spreadsheet through Super Admin → Geography;
`copy_geography` lifts it from an existing database instead. It replaces the target's five seeded
`regions` rows rather than reusing them, because `regions.id` is `gen_random_uuid()` and the two
databases would otherwise disagree about which UUID is North.

## Commands

```bash
python run.py                              # uvicorn on :8000 — DEVELOPMENT database
python -m alembic upgrade head             # DEVELOPMENT unless POSTGRES_DB is overridden
python -m app.scripts.bootstrap            # the platform superadmin
python -m app.scripts.audit_tenancy        # after any schema change
python -m app.scripts.create_database --name <db>      # a new database on the same server
python -m app.scripts.copy_geography --to <db>         # the geography master, ids preserved
```

### ⚠ Orphaned workers, and why "stale code" keeps happening on Windows

Killing the uvicorn **reloader** does not always kill the worker it spawned. The orphan keeps
running and keeps the listening socket, and Windows lets a new server bind :8000 alongside it. You
then have two or more servers answering the same port, each holding the `.env` and the module
graph it started with, and requests land on whichever one wins — so a change appears to take
effect intermittently. This has cost hours across several sessions, presenting each time as
"`--reload` served stale code" or "the fix regressed".

It is not a reload bug. **Before concluding anything is stale, count the servers:**

```powershell
Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
  Select-Object ProcessId, CreationDate, CommandLine        # orphans are the old CreationDate ones
Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object {
  "$($_.OwningProcess) alive=$([bool](Get-Process -Id $_.OwningProcess -EA SilentlyContinue))" }
```

A listener whose process is dead is a harmless stale socket entry. A `spawn_main` python process
older than your last restart is an orphan — `Stop-Process -Id <pid> -Force` it.

Two traps that hid this:

- **`taskkill /PID` does not work from Git Bash.** MSYS rewrites `/PID` into a path and taskkill
  errors out. Use PowerShell `Stop-Process`, and never redirect the kill's output to `/dev/null` —
  suppressing it is what let a failed kill look like a successful one.
- **Background commands do not inherit a `cd` from an earlier Bash call.** Launch the server with
  absolute paths, or it exits 127 and the previous server keeps serving while you believe you
  restarted it.

## GSTIN lookup — where a vendor's details come from

`POST /vendors/gstin-lookup` asks **GSTZen's GSTIN Validator** what the GST registry holds for a
GSTIN, and the console fills the vendor form from it: name, PAN, GST company status, and the
registered address. `app/integrations/gstzen.py` owns the call; `RequirementDocs/GSTRequest.txt`
is the provider's contract.

**`status` and `valid` answer different questions, and conflating them is the bug to avoid.**
`valid: false` is about the GSTIN — not registered, and the console blocks the save.
`status: 0` is about **us** — the subscription is spent or lapsed — and blocks nothing at all.
Three outcomes, never two:

| `outcome` | Means | Console |
|---|---|---|
| `found` | registered | fills the form |
| `not_registered` | a real refusal | blocks the save |
| `unavailable` | we could not ask | blocks **nothing** — everything stays typeable |

Same degradation rule as WhatsApp and ACS: **leave `GSTZEN_TOKEN` empty and nothing 500s.** The
lookup reports itself unavailable and the form is typed by hand, exactly as before it existed.
Which also means a deploy that forgets the variable looks like a working build with a form that
has quietly stopped filling itself in — set it in the Azure App Service settings, not only in
`api/.env`.

**Every call spends a unit of a metered subscription.** Hence the two guards worth keeping: the
request is refused with a 422 before it leaves this process unless the GSTIN is well-formed
(`GstNumber`, shared with companies), and the console holds each answer with
`staleTime: Infinity` under its own `gstin-lookup` query key — deliberately outside the
`vendors` prefix, so saving a vendor does not evict what the registry said and buy it again.

**A subscription failure emails this company's National and Regional Heads**, at most once a day
(`vendors/service._alert_heads` → `emails/alerts.py`). Nothing else would tell them: from the
screen a dead subscription looks like a form that has gone quiet. A timeout does *not* alert —
it fixes itself, and an alert that cries wolf is one nobody opens. The throttle is in process
memory, so a restart or a second gunicorn worker can send one extra; that was judged better than
a table and a migration for an alert clock.

`python -m app.scripts.check_gstzen` verifies the whole mapping against the provider's recorded
payloads — **offline, spending nothing**. Run it after touching the mapper. It pins the two
traps in that payload: `state` is the display composite `"36 - Telangana TS"` (the real value is
`state_info.name`), and `pradr.addr` already contains the city, district, state and pincode we
store in their own columns, so the street line is assembled from the structured parts instead.

The GSTIN also encodes two things we can check for free — `gstin[:2]` is the state code and
`gstin[2:12]` is the PAN, which is what the backfill in `d3f27a8c1904` relied on. A mismatch is
logged, never enforced: the registry is the authority on its own payload.

## Email — the temporary password

A new console account (user, vendor, vendor user, company admin) gets a **server-generated**
password, emailed through Azure Communication Services. Nobody types one any more.

The same degradation rule as WhatsApp, and for the same reason: **leave `ACS_*` empty and
nothing 500s.** The account is still created, and the plaintext comes back in the response as
`temporaryPassword` so the manager can hand it over. It is returned **only** when
`emailStatus == "failed"` — always returning it would put a live credential in every HTTP log,
and never returning it would leave the account reachable only through a mailbox that has just
proved unreliable. `POST /users/{id}/reissue-password` (and the vendor twin) is the way back in
when the email is lost.

That escape hatch is for an **authenticated manager only**. `/auth/password-reset/*` is open,
and deliberately has no equivalent: handing a credential back when the mail fails would be an
oracle anybody could ask.

## Forgotten passwords — the email OTP

Staff used to have no self-service reset at all. They do now, and it is three unauthenticated
calls, mirroring the technician OTP flow one field over:

| Path | Body | Answers |
|---|---|---|
| `POST /auth/password-reset/request` | `{ email }` | `OtpRequestResponse`, `channel: "email"` |
| `POST /auth/password-reset/verify` | `{ email, code }` | `{ resetToken, expiresInSeconds }` |
| `POST /auth/password-reset/confirm` | `{ resetToken, newPassword }` | the same `LoginResponse` `/auth/login` gives |

Four things about it are load-bearing:

- **The codes live in `otp_codes`, not a table of their own.** `phone` is nullable, `email` sits
  beside it, and a CHECK says exactly one is set. That is what lets a reset inherit the pepper,
  the TTL, the five-attempt burn, the resend cooldown and both window counters instead of
  growing a second copy of each — copies drift the first time one of those numbers is tuned.
- **The `resetToken` is a JWT bound to the password hash it was minted against** (`pwd` claim,
  `type: "pwreset"`). Setting a password changes the hash, so the token that set it dies, and so
  does every sibling minted in the same window. That is the whole revocation mechanism; there is
  no table, because the only thing the token can do is the thing that invalidates it.
- **An unknown address is a 404**, matching `_find_technician_user` and `/auth/google`. The bland
  200 leaves somebody who mistyped their own email on a code screen no code will ever reach.
- **A bad token is a 400, never a 401** — the console's transport reads 401 as an expired access
  token and would burn a refresh replaying it. All three paths are on its `NO_REFRESH` list.

Vendor portal users and superadmins are admitted; technicians are refused, because a phone is
their credential and there is no password to reset. Verify and confirm both re-resolve the
account, so one disabled between two requests is caught before a password is set.

⚠ **Set `ACS_EMAIL_ALLOWLIST` to your own address before exercising any create form.** The key
in `.env` is live and is the SAME resource production uses, so an invented test address sends
real mail to whoever owns it. `publish.py` refuses to deploy while the allowlist is non-empty,
which is what keeps it a development-only guard.

Three outcomes, and the console branches on the field, not the message — `apiPost` returns
`data` and drops `message`: `sent` (Azure accepted it; not proof of delivery, there is no
webhook) · `failed` · `skipped` (the email already belonged to an identity that keeps its own
password — `users` is global, so minting a new one would sign that person out of every other
company they work in).

## Google sign-in

`POST /auth/google` takes the ID token from Google Identity Services — the button and One Tap
both produce it — and answers with the same `LoginResponse` as `/auth/login`. There is **no
client secret** anywhere: the credential flow has no authorization code to exchange.

It **never creates an account.** An address Google verifies but this database has never seen is
a 401, not a new user; otherwise anyone holding a Gmail could mint a tenant account.

`GOOGLE_CLIENT_ID` lives as a **default in `config.py`**, not in `.env.production` — it is
public (it is inlined into the console bundle), so it belongs with the code, exactly like
`CORS_ORIGINS` and `ANDROID_PACKAGE`. It must match the console's `VITE_GOOGLE_CLIENT_ID`, which
lives in the Netlify UI.

⚠ **The console's origins must be listed under "Authorized JavaScript origins"** on that client
in Google Cloud — both `localhost` and `127.0.0.1`, ports 5173-5175, plus the Netlify host. A
missing origin fails **entirely client-side**: the button does nothing, and no request ever
reaches this API, so the logs show nothing. Same class of silent, outside-the-repo prerequisite
as `CORS_ORIGINS`.

## Testing onboarding without Meta credentials

Leave `WHATSAPP_*` empty. Invites then record a retryable failure with a copyable link, and OTP
codes come back in the response as `devCode` and to the server log. Startup **refuses to boot** in
production with `OTP_DEV_ECHO` on or `OTP_PEPPER` empty.

`INVITE_LINK_BASE` defaults to `reliancegreentech://invite`, which opens straight into Expo Go:

```bash
npx uri-scheme open "reliancegreentech://invite/<token>" --android
```

That default cannot ship — WhatsApp only auto-links `http(s)`, so a custom-scheme link arrives as
dead text. Production needs an https universal/app link with a web fallback.

### ⚠ Deploy the API BEFORE installing a mobile build that changed its package id

`/.well-known/assetlinks.json` is served from `ANDROID_PACKAGE` and `ANDROID_CERT_FINGERPRINTS`.
Android fetches it **at install time**, not when a link is tapped, and if it does not name the
package and signing certificate of the app being installed it simply declines to verify. There is
no error anywhere: invite links just start opening a browser, and the only way to notice is to
tap one.

So the order is always **deploy the API first, then build and install the app.** Installing a
build whose package the live API does not yet vouch for burns the App Link on every device that
installed it — reinstalling after the deploy is the only way back.

`ANDROID_PACKAGE` is deliberately NOT set in `.env.production`; it falls through to the default in
`app/core/config.py`, so it moves with the code rather than being a value someone has to remember
to change in two places. Check what is actually live before a build:

```bash
curl -s https://installflowapi-bqh6d9e2hhaedye0.centralindia-01.azurewebsites.net/.well-known/assetlinks.json
```

**Changing the Android package gives you a NEW signing key.** EAS keys its Android credentials by
application identifier, not by project, so `com.reliancegreentech.technician` was issued a fresh
keystore even though the projectId never moved. The published fingerprint did not match the new
APK, and App Links would have failed in the silent way described above. Measured, not assumed —
the first build after the rename came back `EE:54:…`, against `07:85:…` in the deployed file.

So after ANY build that changes the package, read the fingerprint off the artifact and ADD it —
`ANDROID_CERT_FINGERPRINTS` is a comma-separated list precisely so old and new builds can both
verify while devices catch up. Never replace: that breaks whoever has not updated yet.

`apksigner verify --print-certs app.apk` is the documented way. There is no Android SDK on the
dev box here, and EAS signs with scheme v2 only — no `META-INF/*.RSA` to read — so the fingerprint
was taken by parsing the APK Signing Block (`APK Sig Block 42`, pair id `0x7109871a`) and
SHA-256'ing the certificate DER. Any method is fine; taking it from the ARTIFACT rather than from
what you expect is the part that matters.

### When WhatsApp is configured and sends still fail

The `failureReason` on the invite row is Meta's own message. The ones seen so far:

| Code | Means | Fix |
|---|---|---|
| `133010` **Account not registered** | The phone number is verified but has never been registered to the **Cloud API**. `GET /{phone_number_id}` shows `status: PENDING` and `platform_type: NOT_APPLICABLE`. Nothing can be sent — not templates, not free-form. | `POST /{phone_number_id}/register` with `{"messaging_product":"whatsapp","pin":"<6-digit>"}`, or register it in WhatsApp Manager. The PIN is the number's two-step verification PIN. |
| `131047` | Outside the 24-hour customer-service window — the recipient has not messaged the business number recently. Free-form text cannot reach them. | Send through an approved template instead. |
| `132001` | Template name or language does not exist. Language is exact: a template registered as `en` will not match `en_US`. | Check `GET /{business_id}/message_templates`. |

`WHATSAPP_TEMPLATE_NAME` (the invite) is deliberately EMPTY unless a UTILITY template exists whose
body takes exactly one parameter — the link. Pointing it at an unrelated approved template sends
that template's words, not an invite. With it empty the code falls back to free-form text, which
only reaches someone inside the 24-hour window; that is fine for testing against your own number
and not fine for real onboarding.

`WHATSAPP_OTP_TEMPLATE_NAME` must be an **AUTHENTICATION**-category template with one body
parameter and a copy-code button — `_template_payload(otp_button=True)` fills the code into both.

### A registered template's wording is a deployment, not an edit

Every `build_*_payload` has two bodies: the registered template's parameters, and a free-form
fallback for development. **They are allowed to differ, and one pair deliberately does** — fix the
fallback and leave a note rather than quietly making them match, because matching them means either
shipping the wrong words or a days-long Meta re-submission.

Two rules the templates themselves impose, both already paid for:

- **A parameter must complete the sentence around it, not repeat it.** `job_escalation` reads
  "…and the slot is {{4}}", and {{4}} was fed `hours_to()`, which appends "to slot" — so every
  escalation Meta ever delivered said *"the slot is 2h 40m to slot"*. Fixed at the CALLER:
  `core/escalation` now splits `time_to_slot` (bare span) from `hours_to` (suffixed, for a bell
  title that supplies no suffix of its own).
- **A body may not start or end with a variable** — subcode `2388299`. It cost a submission on the
  feedback template, which is why `job_feedback` opens with "Your" and `job_escalation` with
  "Escalation" rather than with `{{1}}`.

Currently diverging on purpose: the registered `job_escalation` body says "reassign it", which is
wrong — nothing was ever assigned, so there is nothing to RE-assign, and the word sends a manager
hunting for a technician to replace. The fallback says "assign a technician". Correct the
registered body with the next template change, not on its own.

### `technician_assigned` is NOT registered yet

`WHATSAPP_TECHNICIAN_TEMPLATE_NAME` is empty in both `.env` files, so
`sweep_customer_notice` currently falls back to free-form text and reaches nobody outside the
24-hour window. Everything else about the feature works — the sweep runs, and the ticket's
`customer_notified` event records Meta's refusal — so what is missing is one UTILITY submission,
not code. The body to register, five parameters, opening with "Your" for subcode `2388299`:

```
Your {{2}} visit from {{1}} is today at {{3}}.

{{4}} will be attending. You can reach them on {{5}} if you need to.

Please make sure someone is available at the address.
```

Parameters in order: company, product, slot, technician, technician's mobile. The company is a
parameter for the reason it is in every other template here — one WABA sends for every tenant.
