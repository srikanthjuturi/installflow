# Videocon Installation API

FastAPI + PostgreSQL behind the ops console (`adminWeb/`) and the technician app
(`mobileapp/`). Read the root `AGENTS.md` first for the business flow and the domain facts.

Live today: auth (password + technician OTP + change-password), companies, users & roles,
territory, **the geography master and its spreadsheet importer**, the product master, technician
onboarding in both modes, **vendor accounts and their sub-users**, and tickets (vendor intake,
the list, and the customer's own slot confirmation).
Still to come: jobs, the pool, proof capture, escalations, the ledger.

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

#### Three counting facts about the geography master

They are load-bearing: every one of them makes an obvious-looking sum wrong, and the console
states each out loud rather than hiding it.

- **District pincode counts do not sum to the state's total.** They are counted through
  `pincode_districts`, and **1,209** of the 19,496 pincodes sit in two to four districts, so each
  is counted once per district. Kerala is 1,428 pincodes and 1,450 across its districts. Never
  present that sum as a total. (Comments saying 1,258 were stale by 49 and have been corrected.)
- **Four pincodes are in no district at all** — `222101`, `390008`, `605012`, `804454`. Anything
  that walks state → district → pincode drops them silently. `GET /geo/pincodes?noDistrict=true`
  is how you reach them, and it exists for exactly that reason.
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

---

## Layout

```
app/
  api/router.py          the ONLY place slice routers are imported
  core/                  config, database, deps (Principal + guards), errors, features,
                         icons, phone, schemas (the envelope), scope, security,
                         sequences, sessions (revoking refresh tokens)
  db/                    base_class (naming convention), mixins, repository (territory_scope)
  features/<slice>/      router.py · schemas.py · service.py — nothing else
                         NB `vendor_users` is its OWN slice, not part of `users`:
                         `users.*` gates the COMPANY's staff, and a vendor
                         holding it could read every manager in the tenant.
  integrations/          whatsapp.py, otp_channel.py — outbound, and never raise on failure
  models/                one module per area; every model reachable from __init__
  scripts/               bootstrap, audit_tenancy
alembic/versions/        hand-written, with a prose docstring saying WHY
```

## Commands

```bash
python run.py                              # uvicorn on :8000
python -m alembic upgrade head
python -m app.scripts.bootstrap            # the platform superadmin
python -m app.scripts.audit_tenancy        # after any schema change
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

## Testing onboarding without Meta credentials

Leave `WHATSAPP_*` empty. Invites then record a retryable failure with a copyable link, and OTP
codes come back in the response as `devCode` and to the server log. Startup **refuses to boot** in
production with `OTP_DEV_ECHO` on or `OTP_PEPPER` empty.

`INVITE_LINK_BASE` defaults to `videocontech://invite`, which opens straight into Expo Go:

```bash
npx uri-scheme open "videocontech://invite/<token>" --android
```

That default cannot ship — WhatsApp only auto-links `http(s)`, so a custom-scheme link arrives as
dead text. Production needs an https universal/app link with a web fallback.

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
