# Reliance GreenTech Installation API

FastAPI + PostgreSQL behind the ops console (`adminWeb/`) and the technician app
(`mobileapp/`). Read the root `AGENTS.md` first for the business flow and the domain facts.

Live today: auth (password + technician OTP + change-password), companies, users & roles,
territory, **the geography master and its spreadsheet importer**, the product master, technician
onboarding in both modes, **vendor accounts and their sub-users**, and tickets (vendor intake,
the list, and the customer's own slot confirmation).
The **job pool** is real too: a confirmed ticket (`status = 'New'`) is offered through
`/jobs/pool` to the technicians whose `technician_pincodes` and `technician_nodes`
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
no-show is detected by a sweep that charges NOTHING and confirmed by a person. **A penalty can be
given back** — in full, by the ticket's Area Manager or anyone senior — see "Reversing a penalty".

Every operating number is per company in `company_rules`, edited on Configuration → Rules Config,
**and any catalogue node may override any of them** in `product_node_rules` (every column
nullable; null means inherit). The band BOUNDARIES are not, and belong in `core/rules.py`: an
amount is policy, but where one band ends is a fact about the clock.

**The DEFAULTS live in code, not in seed data.** `rules.DEFAULTS` is the source, and a company gets
its row stamped from it inside `create_company`'s own transaction; `load_rules` recreates a missing
one on the next read. So `company_rules` holds a company's OVERRIDES — emptying the table resets
rules, it does not destroy them, which is what makes it safe to clear with the tenant data it
belongs to.

**`resolve_rules(db, company_id, node_id)` is the only place the layering happens** —
`DEFAULTS → company_rules → ancestors root-first → the node` — and `create_ticket` calls it ONCE,
stamping the answer on `tickets.rules_snapshot` beside the two prices. Three consequences worth
knowing before touching any of it:

- **No sweep joins `company_rules` any more.** They read the ticket's own snapshot, which made
  every one of them simpler than it was — a JOIN disappeared from each. The self-heal in
  `load_rules` therefore no longer protects the sweeps; it protects Rules Config and intake.
- **Never index a snapshot with a bare `[]`.** A ticket raised before a rule existed has no key
  for it. Read through `rules.snapshot_value` / `snapshot_int` (and in SQL,
  `COALESCE((rules_snapshot->>'x')::int, <default>)`), so adding a thirteenth rule stays a code
  change rather than a data migration.
- **Cross-field invariants are validated on the RESOLVED set, not the submitted one.** A node that
  overrides only `slot_silence_hours` can contradict a company-level `escalate_hours_before_slot`
  it never mentions, and no CHECK can see that. `validate_resolved` is called on every write, a
  node write re-validates its descendants, and a company write re-validates every node that has an
  override row.

`cancel_penalty_cap_paise` is deliberately absent from `NODE_OVERRIDABLE_KEYS`: it caps a
technician's calendar month across all their jobs, so it cannot have a per-ticket answer.

**One job term is deliberately NOT snapshotted: `vendors.location_check_enabled`.** It switches off
every refusal in `_check_live_was_taken_at_the_job` for the vendor who raised the ticket, and
`submit_proof` reads it at the moment proof arrives rather than off `rules_snapshot`. That breaks
the rule the snapshot exists for, on purpose: the switch is what a manager reaches for while a
technician is standing on a site that cannot produce a GPS fix, and a value frozen at intake could
never do that job. The cost is real and is the thing to weigh before copying the pattern — flipping
it changes jobs already accepted, in both directions.

Three things keep it honest. `_location_checks` is one indexed query, kept out of `_hydrate`
because that also serves the pool, where `JobOfferOut` has no such field. A vendor that does not
come back resolves to **True** — an unreadable switch is not an open one. And off never stops the
measuring: the distance is still computed and still written to the `started` event, with
*"location check off for this vendor"* appended, because a trail that cannot distinguish "checked"
from "not checked" is worse than one that says neither.

**`GET /tickets` takes three filters that exist only so the DASHBOARD can link honestly.**
Every figure on that screen has to open a list holding exactly what it counted, and three of them
name populations a single status cannot: `status` therefore accepts a comma-separated **set**
(`Assigned,In Progress`, `Closed,Force-Closed` — one value behaves exactly as before), `open=true`
is "not yet closed", and `closedWithinDays=7` is the rolling window "Closed this week" is measured
over. The last two are `service.open_tickets()` and `service.closed_in()` — the same expressions
`dashboard_summary` counts with, called from both places rather than written twice, which is what
stops a tile and its list drifting apart. `funnel.closedWithinDays` reports the window the count
actually used (**null when a date range is in force**, because the range bounds it instead), for
the same reason `AttentionOut` sends its two hour-counts: the console must filter on the number the
count used, not on one it hard-coded. An unknown member of a set empties the page rather than
422-ing it — these values arrive from a shareable query string, and a stale bookmark must not break
the screen.

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
`vendor_price_paise`, `tickets` stamps both at intake, and closure writes a third `LEDGER_KINDS`
value, `payout`. Two writers, and they shipped with the kind (hard rule 8): `feedback_service` on a
customer-confirmed closure credits the full amount, `force_close_ticket` credits what the manager
entered, clamped to the ticket's price and writing no row at zero.

⚠ **Both price columns are NULLABLE, and an unpriced model IS a state now** — it is a product a
vendor submitted and nobody has approved. That reverses what this section used to say, and it did
not give up the guarantee, it moved it: `approved_is_priced` says an approved row is a priced one,
and `_resolve_product` refuses anything that is not approved. Approved implies priced, so intake
still cannot reach an uncosted model. See **Vendor-submitted products** below.

Three things about it are load-bearing:

- **The masking is by principal, in the serializer.** `masters.get_tree` and `tickets._hydrate`
  both null `technicianPayoutPaise` for a vendor — `_hydrate` takes `principal` for that one
  reason, so the decision lives in one place rather than at its four call sites. The jobs slice
  needs no such branch: `JobOfferOut` has no vendor-price field, and must never grow one.
  On `ProductModelOut` that field is now null for **two** reasons — withheld from a vendor, or
  genuinely unset before approval — and they are indistinguishable on the wire on purpose, because
  both mean "no figure for you". `vendorPricePaise` is optional for the second reason only; it is
  never masked. A client renders neither as a dash: "— to technician" reads as a number that failed
  to load.
- **A payout is not pool money.** `core.ledger.pool` and `features/ledger._entries_query` both
  restrict to `POOL_KINDS`; `features/earnings` reads the same table unfiltered, because the
  technician's own list is all three kinds. Left unfiltered, the console's pool screen would list
  wages under a balance they are not part of.
- **`net = earned + bonuses − penalties`**, in one grouped query in `earnings.summary`, so the
  three tiles and the hero figure cannot come from different reads. It may be negative.

Still to come: **AI review**, the **dashboard**, and the **redeem-cash flow** — a technician's
`upi_id` is collected (console add/edit, the joining flow, and `PATCH /technicians/me/payout-account`)
but nothing spends against it yet.

**A slot can move**, which is what finally clears the escalation queue's missed half. Two doors onto
one mover in `core/reschedule.py` — the technician's, gated by a one-time code sent to the
**customer's** phone (`otp_codes.purpose = 'reschedule'`, keyed on `ticket_id`) and read back to
them; and the console's, `jobs.reschedule` + an Area-Manager floor, no code and a required reason.
Nothing is charged either way: the customer agreed.

Six things about it are load-bearing:

- **`sla_due_at` is FROZEN, never re-based.** The promise made at intake is a fact, and a ticket
  that is rescheduled goes on reading as breached — which is true. The replacement window is
  bounded by `core.tickets.RESCHEDULE_HORIZON_HOURS` instead, and `offered_slots` grew a `horizon=`
  for exactly one caller. Bounded by `sla_due_at` the list would be EMPTY on precisely the tickets
  the feature exists for.
- **The code is minted for ONE WINDOW, not just one ticket.** `otp_codes` carries both `ticket_id`
  and `slot_start`, and `consume_code` filters on both. Either alone is a hole: `_mint` keeps one
  live code per destination, so without the ticket a customer's second code verifies their first
  visit; and without the window a valid code books any time at all, proving a conversation
  happened without pinning what was agreed in it. Changing the window means asking again — it is a
  different question.
- **Six sweeps re-arm against it.** Their dedupe asked "has this ever happened to this ticket",
  which after a move is the wrong question — nobody has been reminded about the NEW slot, and the
  customer has not been told who is coming to it. `_rearmed(marker, _last_event("rescheduled"))`
  is the predicate, and for a ticket that never moved it collapses to exactly the old test.
  ⚠ Event-vs-event comparisons use **`seq`, not `created_at`**: `now()` is the TRANSACTION's start
  time, so a sweep that began just before a reschedule committed would stamp its own marker
  *earlier* than the move and remind twice. `seq` is assigned at INSERT and cannot.
- **`Escalated` splits in two and only one half may be moved.** With no technician it means
  "nobody accepted" and rescheduling is the remedy; WITH one it means "the customer said it was
  not done", and giving that a new time would launder a complaint into an appointment. Refused
  with `ESCALATION_IS_A_REFUSAL`.
- **`slot_confirmed_at` is written by the technician's door only.** It means "the customer picked
  this" and the console prints exactly that sentence off it, so a manager who agreed a time on the
  phone has not earned it. That door spends the `slot_token` instead — same protection against the
  customer's stale link overwriting a fresh booking, without the false claim.
- **Everybody who needs telling is told**, and each by the right channel: the customer a WhatsApp
  naming BOTH windows (its own template, never a second "your visit is confirmed"), the technician
  a push when a manager moved their day, and the vendor a `rescheduled` notification — they asked
  for the visit and were the one party a move never reached. A code sent to a number that is also
  the technician's own is allowed, recorded on the trail and rung to the area manager: refusing
  would punish a technician installing at their own address with a cancellation penalty.

One thing nothing clears yet, deliberate and needing a product decision rather than code: the
vendor is never told their customer's slot is at risk.

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

**Never trust a client-supplied id.** Resolve it through a scoped loader (`_load_node`,
`_load_model`, `_load`, `_load_invite`) that already has `company_id` in its WHERE clause. An id
that arrives in a request body is an assertion, not a fact.

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

#### The spreadsheet is the record. There are still no overrides.

`RequirementDocs/Reliance Green Tech Pin Code.xlsx` is what the importer reads. An earlier version
carried researched corrections in a `pincode_overrides` module; they were deleted because an
override outranks the file — so fixing the file stopped fixing the master, and you could not tell
from the sheet what the master would end up holding.

Three importer rules that make bulk loading safe: it is **additive** (creates and updates what the
file names, never deletes what it omits, so a one-state sheet is fine on its own); a **tie is
refused by name** rather than guessed at; and **`#N/A` rows are dropped**, with any pincode that
appears on nothing else reported individually. Corrections already applied to the sheet are in
`RequirementDocs/apply-pincode-corrections.py` (declarative, re-runnable on a fresh vendor export)
and explained in `Pin Code corrections.md`.

**A superadmin can also edit a pincode by hand**, and that is not what was deleted. `POST
/geo/pincodes`, `PUT /geo/pincodes/{code}`, `PATCH /geo/pincodes/{code}/status` and `POST
/geo/districts` write the **master rows themselves**, so they are a peer of the importer rather
than a tier above it: there is no hidden layer, and re-uploading the sheet still decides the
answer. It exists because `_assert_pincode_known` refuses intake for a code the master lacks, and
re-uploading 19,496 rows is not a remedy for one missing pincode.

**Know what a re-import does before you rely on a manual edit.** It differs by field, nobody could
guess it, and it falls straight out of `import_geography`:

| Manual edit | Next upload of the sheet |
|---|---|
| **Added** a code the sheet never names | **Survives, permanently** — absent from `chosen`, and `touched` is built from `chosen`, so neither the row nor its links are considered |
| **Moved** a code the sheet names to another state | **Reverted**, and counted as `moved` in the report — visible, not silent |
| **Changed the districts** of a code the sheet names | **Replaced wholesale** by the sheet's |
| **Switched a code off** | **Survives** — `is_active` is written only on create |

In one line: **the sheet owns where a pincode is; the console owns whether it is on.**

Two consequences worth holding on to:

- **`pincodes.source` exists because of row one.** A hand-added code outlives every future import,
  so `'manual'` means exactly *"the spreadsheet does not cover this"* — the only way anybody
  reconciling the sheet later could find those rows. The importer flips a code back to `'import'`
  the first time the file names it, and only for codes that are currently `'manual'`: setting it
  on every code the file names would turn the `pincodes.updated` no-op branch into 19,496 writes
  per import.
- **Nothing is ever deleted, only switched off.** No foreign key protects the bare six characters
  in `tickets.pincode`, `tickets.device_pincode`, `technician_pincodes.pincode`,
  `technician_invite_pincodes.pincode` or `notifications.pincode`. Deleting the row would leave
  every one of them resolving to nothing, silently. The code is immutable for the same reason.

**Exactly one read filters `is_active`, and that is deliberate.** `list_pincodes` is active-only
unless asked otherwise, because every caller but the Geography screen is a picker and offering a
code intake will refuse is worse than not offering it. `core/scope.py`, `core/coverage.py`,
`core/visibility.py` and `technicians.check_pincodes_exist` all deliberately do **not** filter:
they answer "who can see this ticket" and "who covers this job" for work that already exists, and
filtering there would hide live tickets and refuse edits to technicians whose coverage predates
the switch-off. Do not "fix" them.

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
the superadmin out of the very screen that maintains this data. Every **write** is
`require_superadmin`: the importer, the template, and the four manual writers above.

Geography is global, so **404-not-403 does not apply here** — there is no tenant to leak by
confirming a code exists, and an unknown one is an ordinary 404.

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

⚠ **That round trip proves the SCHEMA reverses. It does not prove the DATA survived**, and the
difference is not academic — it destroyed a real row in the dev database. `a7c93f5e2b18`'s
downgrade ran `DELETE FROM product_nodes WHERE parent_id IS NULL` while the self-referencing
foreign key (`ON DELETE CASCADE`, pointing at the same table) was still in place. It did not
delete the roots; it deleted the **whole tree**, silently, and all three commands above still
exited 0 because the DDL was perfectly reversible. The fix was one line moved — drop the FK
first. The lesson is in the test: seed a row, walk the trip, and compare **ids on the way out with
the ids that went in**.

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

That applies to **`op.drop_constraint` as well as `create_check_constraint`**, which is the half
that surprises people: the convention is applied on the way out too, so a downgrade passing the
full name goes looking for `ck_product_models_ck_product_models_parameters` and fails on a
constraint that is plainly there. Pass the bare name in both directions.

⚠ **A UNIQUE is named the other way round, and the rule above is exactly why people get it
wrong.** Look at `NAMING_CONVENTION` in `db/base_class.py`: `ck` is
`ck_%(table_name)s_%(constraint_name)s`, so a CHECK's given name is INTERPOLATED into a prefix.
`uq` is `uq_%(table_name)s_%(column_0_name)s` and contains no `%(constraint_name)s` at all, so an
explicit name is taken **verbatim** — nothing is prepended. Spell a UNIQUE with its full
`uq_<table>_...` name, the way `uq_vendors_company_id_id` already does.

Written bare, `UniqueConstraint(..., name="vendor_address_searches_session")` compiled to exactly
that while the migration's `op.f("uq_vendor_address_searches_session")` put the prefixed name in
the database. Nothing failed loudly: the table was created, the tests passed, and `alembic check`
simply reported a drop-and-recreate of that constraint on every run, for ever. It would also have
broken the `on_conflict_do_nothing(constraint=...)` that names it. Caught in `c1a7f30d92b8`.

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
intake form has a product tree, and `masters.service.get_tree` and `/vendors/options` therefore
substitute the caller's own vendor for whatever was asked for. `_resolve_product` additionally
checks `model.vendor_id == vendor.id` — the composite FK constrains `(company_id, vendor_id)`, not
`(vendor, model)`, so nothing else says it.

**A vendor WRITES to the product master now**, which this section used to assume away. It goes
through `/masters/portal/*` on `vendor.catalogue`, and the pinning is structural rather than
checked: `ProductSubmitRequest` has no `vendorId` field for one to arrive in, and
`_load_own_model` matches on `vendor_id` as well as `company_id` so an edit cannot reach a
competitor's row. A CATEGORY has no vendor column, so `_load_own_node` pins it the only way the
schema allows: its `created_by` must be one of the vendor's own logins (`_vendor_user_ids`, via
`memberships.vendor_id`). The six staff writes gained `require_staff_principal` in the same change — not
because a vendor holds `masters.edit` (none does), but because `_validate_vendor` proves a body's
`vendorId` names a live vendor *in the company* and never that it names the caller's own, and that
gap was one Feature Access toggle from being live.

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

## The product master is one recursive table

`product_categories` and `product_subcategories` are gone. `product_nodes` replaced both, and
`product_models` still holds the priced, vendor-owned leaf rows that hang off a node.

```
product_nodes
  parent_id      NULL = a root category. Self composite FK on (company_id, parent_id).
  depth          SMALLINT, CHECK 0..5, denormalised
  ancestor_ids   UUID[] root-first, excluding self. GIN indexed.
  is_leaf        "This is the last sub-category" — only a leaf takes products
  parameters     JSONB — the leaf's field TEMPLATE (value optional)
  icon_key       nullable at every level; the nearest ancestor's is used

product_models
  node_id           renamed from subcategory_id, same UUIDs
  parameters        JSONB — this product's specs (value REQUIRED)
  notes             TEXT
  approval_status   pending | approved | rejected. NOT NULL, defaults 'pending'
  submitted_at      when it last ENTERED pending. NULL = never waited
  decided_at        )  both set or both null
  decided_by        )  the deciding user. No FK — the ActorMixin reason
  rejection_reason  VARCHAR(255) — bounded where it is WRITTEN, because it is
                    quoted verbatim into notifications.detail, which is 255

product_model_serials
  product_model_id  composite FK on (company_id, product_model_id)
  serial            VARCHAR(64), matching tickets.serial_number
                    UNIQUE (company_id, product_model_id, lower(serial)) —
                    hand-written, TOTAL (no deleted_at on this table)
```

**A model carries the serial numbers it covers, and an EMPTY list means UNCHECKED.**
`tickets._assert_serial_known` refuses a vendor's typed serial only when the model has at least one
row in `product_model_serials`. That is not a hedge — it is what let the check ship against a live
catalogue with no backfill and no flag day, so a company loads its models one at a time instead of
every vendor's intake breaking on deploy. `ProductModelOut.serialCount` carries it to both clients
for the same reason: zero is a *state*, not an empty list, and the console has to be able to say
"this model is not checked" without somebody opening it.

Three things about it are load-bearing:

- **A serial is never CONSUMED.** Raising a ticket spends nothing here and marks nothing used.
  `tickets.serial_number` is deliberately not unique — a service call on a unit installed months
  ago repeats its serial — so a row has to keep matching for the life of the unit. Treating these
  as stock to draw down would break the second visit to every customer.
- **The check is two queries, and the order is the point.** An index probe for the typed serial
  answers the common case; only a MISS pays for the `EXISTS` that tells "not loaded, allow" from
  "loaded, refuse". Counting the model's serials up front is the obvious implementation and the
  wrong one — it reads thousands of rows to answer what the unique index already answers.
- **`correct_serial` runs the same guard**, and without it the whole thing is bypassable: raise the
  ticket quoting a serial the model covers, then `PATCH /tickets/{id}/serial` to anything. That
  endpoint is open to the vendor by design, which is exactly who the intake check is for.

Staff load them (`masters.edit` + `IsStaff`), by hand or from a spreadsheet. The importer is
deliberately the same shape as `features/geo`'s — template, dry run, per-row rejects that never
block the good rows — and reuses its numeric-cell guard, without which an all-digit serial arrives
from openpyxl as a float and stores as `1.23456789012e+11`.

**A vendor manages its OWN products' serials too — add, import, correct, remove.** It holds the
invoice, which is the same fact that makes the expected serial mandatory at intake, so it is the
party that actually knows these numbers. Four `/masters/portal/models/{id}/serials…` routes on
`vendor.catalogue`, every one through `_serial_target(own_only=True)` → `_load_own_model`, so
another vendor's model is a 404 rather than a refusal.

⚠ **Delete lets a vendor lift its own gate**, and that is a decision rather than an oversight.
Removing the last serial turns intake checking OFF for that model; adding never can, and an import
is additive so it cannot empty one either. It shipped add-only for exactly that reason, the point
was raised, and the call was made to hand delete over: a vendor who cannot fix its own typo has to
ring somebody to correct a number only it can read. What survives is the WARNING in both clients
when the last one is about to go — not a refusal.

**`update_serial` exists so "edit" is not delete-plus-add.** The row keeps `created_at` and
`created_by`, so a corrected typo still records who loaded that unit and when, and the model never
passes through a moment with one fewer serial than it should. A rename onto a value the model
already carries is a 409, not a 500 from
`uq_product_model_serials_model_serial_lower`.

`list_serials` pins a vendor to its own models for the same reason `lookup_serial` always has.
It was company-scoped alone, so a vendor guessing a model id could page a competitor's serial
list — only a guess, since `get_tree` never shows them another vendor's ids, but hard rule 7 says
a vendor sees only its own and this was the one serial route that did not say it.

`GET /serials/template` is on `masters.view`, NOT staff-only: a vendor importing needs the same
starter file, and it carries no data — one header row and two example serials, identical for every
caller.

**`GET /masters/serials/lookup` runs the check backwards, and it is the one place here that is an
ORACLE RISK.** It answers "which products carry serials starting with this?", so the intake form
can offer a dropdown and fill the category chain, the model and the service type from the number
printed on the unit — the vendor's actual starting point, and four boxes they otherwise derive by
hand.

- **A vendor only ever finds its OWN models**, pinned in `lookup_serial` exactly as
  `_resolve_product` pins the model at intake. Without it a vendor could walk a competitor's
  numbering scheme and read back their product names and catalogue structure, in one request and
  without raising anything. This is a stronger version of the enumeration the intake check already
  orders its refusals to prevent, and **prefix matching makes it easier, not harder** — which is
  why the pinning is in the query and `MIN_SERIAL_QUERY` (3) exists.
- **A PREFIX search, paged and ordered.** It began exact-only, reasoning that a partial serial
  names the wrong product as often as the right one. That was true and beside the point: an exact
  match answers nothing until the last character lands, so the box sat silent through all the
  typing and read as broken. Exactness still decides what the CLIENT does — it fills only when the
  typed value equals a result outright — but that is a question about confidence, not about what
  is worth showing.
- **`offset` pages it, and a SHORT page means the end.** It was a hard cap of ten with nothing
  beyond it, which is fine for confirming a serial you already know and useless for browsing what
  a model holds. No total is computed: counting would be a second query to answer what one
  comparison against `MAX_SERIAL_MATCHES` already answers.
  The ordering is `lower(serial), product_model_id` — **total**, not just deterministic. Ordering
  by the serial alone would repeat or skip rows across pages wherever one serial sits on two
  products, which is legal here.
  Offset rather than a keyset, deliberately: a keyset would need the model id in the cursor for a
  result set that is one company's serials under one prefix, scrolled for a few seconds, and the
  drift offset paging is criticised for needs rows inserted mid-scroll.
  An exact match always lands on the FIRST page — the ordering is by serial, and a serial equal to
  the whole query sorts ahead of everything extending it — which is what lets the client decide
  about autofilling without paging.
- **It needed an index of its own.** `uq_product_model_serials_model_serial_lower` is
  `(company_id, product_model_id, lower(serial))`, so a search that fixes the company and the
  serial but not the model has an unconstrained column in the middle of the key and cannot
  range-scan. `c7f1a4e93b26` adds `(company_id, lower(serial) text_pattern_ops)` — `text_pattern_ops`
  because the default opclass serves equality but not `LIKE 'abc%'` outside the C collation. That
  index is what the exact lookup had always really wanted too.
- **Approved, active, not deleted only.** Offering a product the vendor cannot then submit is worse
  than offering nothing, and it moves the refusal to the end of a long form.
- Empty is the ordinary answer and not an error — most serials are simply not loaded.

**Three independent notions of "not available" on a product, and they do not collapse.**
`is_active` is paused, `deleted_at` is removed, `approval_status` is not yet agreed. Intake tests
all three. The tempting mistake is writing a refusal into `is_active`: pausing is reversible by
whoever paused it and says nothing about whether the row was ever agreed, while a rejection carries
a reason the vendor has to answer — and "paused" would then mean two things.

**`ancestor_ids` is what makes everything else cheap.** Inheritance, technician eligibility and
the breadcrumb are one array test instead of a recursive CTE. It is safe to denormalise only
because **`parentId` is create-only and not patchable** — the array and `depth` are written once
from the parent (`parent.ancestor_ids || parent.id`, `parent.depth + 1`) and cycles are therefore
unreachable. The price of that is **no move/re-parent operation**; see the root `AGENTS.md`.

Four CHECKs guard it — `depth` in range, no self-parent, `NOT (id = ANY(ancestor_ids))`, and
`depth = coalesce(array_length(ancestor_ids, 1), 0)` so the array cannot disagree with the number.
The `parameters` CHECK can only assert `jsonb_typeof(...) = 'array'` and a length cap: walking the
entries needs a set-returning function, which Postgres refuses inside a CHECK, so entry shape and
name uniqueness are schema-layer. And **assign a new list to change it** — SQLAlchemy does not
track JSONB mutation in place.

Two traps that already bit:

- **Root name uniqueness needs `COALESCE(parent_id, <zero uuid>)`.** Postgres treats NULLs as
  DISTINCT in a unique index, so the natural `(company_id, parent_id, lower(name))` would happily
  accept two roots both called "Electronics". Partial on `deleted_at IS NULL`, hand-written, and
  autogenerate will want to drop it every time (hard rule 8).
- **A null JSONB column needs `JSONB(none_as_null=True)`.** Without it psycopg writes Python
  `None` as JSON `null`, which is not what the CHECK means by "unset" — it fails.

### The wire names did NOT change with the columns

`mobileapp` ships as an APK on people's phones, so renaming `subcategoryId` / `subcategoryName` /
`subcategoryIds` on the wire would break every installed build. **The DB columns are `node_id`;
the JSON field names stay as they were.** This is the "wire names differ from columns" divergence
warned about elsewhere in this file, adopted deliberately here — `nodePath` was added alongside
rather than replacing anything. `categoryName` still means the ROOT and `subcategoryName` still
means the node's own name, which is why a product must hang off a node at depth ≥ 1: at depth 0
the two would collapse to the same string.

### Certification sits at exactly one level

`CERTIFY_DEPTH = 1` in `core/product_tree.py` — a MAIN sub-category, the direct child of a root.
`validate_subcategories` enforces it, and all three writers go through it: add a technician, edit
one, and the technician's own self-registration from an invite. The console picker
(`useCertifiableNodeOptions`) and `onboarding/_flatten_for_invite` both narrow to the same level,
so nothing offers what the API would refuse.

Narrowing the list the phone is SENT, rather than teaching the phone to filter, is the point of
doing it in `_flatten_for_invite`: `mobileapp` ships as an APK, and the coverage screen draws
whatever arrives. An installed build picked this change up with no rebuild.

The reach is unchanged — one tick still covers every descendant — so this only removes the two
answers that were worse: a root ("send them anything, for ever", one accidental tick away) and a
deeper node (goes stale the moment a sibling is added, silently). The rest of the reasoning is in
the constant's own docstring.

Eligibility is the same substitution in four places — `pool_query`, the assign guard, push
targeting and `jobs/ws.py`: the technician's certified node id tested against the ticket's stamped
`node_path_ids`. ⚠ `node_path_ids` is an array COLUMN, so `func.any(...)` is right there; when the
path comes from a SUBQUERY instead, `func.any()` renders `= ANY((SELECT …))` and Postgres reads it
as `uuid = uuid[]`. Use `IN (SELECT unnest(...))`. That one 500s at runtime and typechecks
perfectly — it was found by executing the query, not by reading it.

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

`upgrade head` seeds the global reference data itself — roles, regions, features and their role
defaults — so there is nothing else to seed. Geography is the exception, because the tables are
created empty and normally filled from a spreadsheet through Super Admin → Geography;
`copy_geography` lifts it from an existing database instead. It replaces the target's five seeded
`regions` rows rather than reusing them, because `regions.id` is `gen_random_uuid()` and the two
databases would otherwise disagree about which UUID is North.

⚠ This used to name exact counts — "8 roles, 5 regions, 26 features, 78 role defaults". They were
removed rather than updated: every migration that seeds a feature moves two of them, the published
figures had already drifted (hard rule 2 describes `jobs.force_close`, which the initial seed does
not contain), and a stale count is worse than none because somebody eventually diffs against it.
**Measure, do not do arithmetic:** `SELECT count(*) FROM features` and
`SELECT count(*) FROM role_feature_defaults` on a freshly migrated database.

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

## Vendor-submitted products — the approval flow

A vendor may add categories and products to the master, and **may not price them**. What a
technician earns is withheld from a vendor everywhere else here; what a vendor is *charged* is a
commercial term between them and the company, not something they set for themselves. So a
submission waits, unpriced and unticketable, until a National Head or an Admin types both figures.

    vendor submits  ->  pending, both prices NULL, staff bell rings
    NH approves     ->  both prices set, vendor bell rings, intake offers it
    NH rejects      ->  reason recorded, vendor bell rings, vendor edits and resubmits
    vendor edits    ->  approved STAYS approved, prices kept, no bell
                        rejected -> back to pending if anything actually CHANGED
                        pending  -> stays pending

Everything that existed before was backfilled `approved` and kept both prices, so nothing that used
to be ticketable stopped being so.

**Editing an approved product needs no approval.** It used to: any real change sent it back to
pending, unticketable until a National Head looked again. That was dropped on request — a vendor
correcting its own product's details should not lose the ability to raise tickets against it for
a day. The accepted cost is commercial and worth knowing: a vendor can now rename an approved
product and keep the prices agreed for it. Tickets already raised are unaffected either way, because
both prices are stamped on the ticket at intake. A REJECTED product still resubmits, because it has
no agreed prices to keep.

**Two feature keys, and neither is `masters.edit`** (hard rule 2 — "a key that already exists is
not automatically the right key"). `masters.approve` is `jobs.force_close`'s shape: it spends
money, since the payout typed there prices every ticket ever raised against that product, so it is
paired with `require_min_rank(NATIONAL_HEAD)` that no per-company override can lift.
`vendor.catalogue` exists because `masters.edit` also gates PUT and DELETE on **every** node and
model in the tenant — a vendor holding it could rename or delete a competitor's products. Seeded to
`vendor` and not `vendor_user`, the line `vendor.users` already draws; one Feature Access row
widens it per company.

**`approved_is_priced` is the constraint the whole thing rests on.** It replaced the two NOT NULLs,
and it is what makes the one-line gate in `_resolve_product` sufficient rather than hopeful:
approved implies priced, so `create_ticket` needs no null test and cannot produce an uncosted
ticket. Six more CHECKs keep the rest honest — both-or-neither on the prices, no decision on a
pending row, a reason if and only if rejected.

**`get_tree` takes a `purpose`, not two booleans.** `catalogue` (the default) shows every approval
state and keeps empty branches; `intake` shows approved products only and prunes what that empties.
One parameter because they are one question — am I filling this in, or picking from it? A caller
that could ask for approved-only while keeping empty branches would get a picker full of dead ends,
which is what the pruning exists to prevent. `catalogue` is the default so an older client that
omits it keeps seeing everything; defaulting to `intake` would have silently emptied the
maintenance screens the day it shipped. It also fixed a latent bug — pruning used to trigger on
`vendor_id is not None`, so `_one_root` dropped a vendor's brand-new empty category and answered a
committed write with a 404.

**Two audience costs, both measured and both accepted.** Neither is a bug to be found later:

- `product_submitted` carries `pincode=NULL`, so it reaches every staff reader including Area
  Managers who hold no `masters.approve` and are refused by the rank floor. `notifications` has no
  column expressing "staff holding feature X", and adding one would put a third audience dimension
  inside `_visible()` — the one function that must never be wrong — permanently, to fix a cosmetic
  problem with no confidentiality content. `technician_joined` already has this property.
  ⚠ **Nothing filters it, and that is the accepted half.** A manager without the feature sees the
  row and, on clicking it, is bounced by `RequireFeature` — a bell that leads nowhere, which this
  file elsewhere calls the one thing a notification must not be. Hiding the row in the console
  was considered and is WRONG: the unread count is computed server-side, so a hidden row leaves
  a badge reading 3 above a feed showing nothing. The only honest fix is server-side, and it is
  a real option rather than a forbidden one — a `kind -> required feature` map consulted in
  `_visible()`, using `core.features.effective_features`. It was left out because it changes the
  one function that must never be wrong, not because it is unthinkable. Do it the day somebody
  complains, and do it there.
- The two decision kinds carry `vendor_id`, which **widens and never narrows**, so they land in
  staff feeds too with a `to` pointing at the portal. `assigned` already ships the same compromise.
  Two mitigations: the wording — *"43 inch LED (Samsung) approved"* is true on a manager's screen
  where *"Your product was approved"* would not be — and `NotificationList.routeFor`, which
  rewrites the portal route back to `/approvals` for a staff reader. Without that second half a
  manager clicking one landed on `/portal/products` and was bounced to `/` by `RequirePortal`. ⚠ And a decision's `detail` must never quote
  `technician_payout_paise` — that row reaches the vendor's portal, and one f-string would undo the
  masking `get_tree` and `_hydrate` both enforce.

**A vendor-created CATEGORY is not reviewed**, deliberately. It is company-wide, carries no vendor
and no price, and an empty one offers nothing at intake — `purpose=intake` prunes it from every
picker and other vendors' brand-filtered trees never show it. The worst case is a junk row an admin
deletes.

**A vendor edits the categories it CREATED, and no others** — `PUT /masters/portal/nodes/{id}`,
not reviewed either. Owned means `created_by` is one of the vendor's logins, sub-users included and
removed ones too, since a category a former sub-user added still belongs to the vendor. Anything
else — seeded, staff-made, another brand's — is a 404 through `_load_own_node`. The body is
`NodePortalUpdateRequest`, which is the staff one less `sortOrder`: where a category sits among the
whole company's is not one vendor's call. The write itself is shared (`_apply_node_update`), so the
leaf guards cannot drift between the two doors. `ProductNodeOut.isOwn` tells the portal which rows
to offer "Edit category" on; it is always false for staff. There is still no portal DELETE. What is worth watching instead is coverage: a product filed under a brand-new main
sub-category has no certified technicians, so every ticket raised there escalates immediately with
nothing on screen saying why. The approvals queue therefore carries `technicianCount` and the
console warns on zero **before** the decision.

## Reversing a penalty

A cancellation or no-show penalty can be given back — **in full, once, with a written reason** —
from the ticket's page: `POST /tickets/{id}/penalties/{entryId}/reverse`. `entryId` names ONE
penalty, because a ticket can carry several (each technician who cancels it pays their own band).

**Who: the ticket's Area Manager, else its Regional Head, else a National Head, else an Admin — or
anyone senior.** That needs no rule of its own. The route carries `penalties.reverse` (its own key,
the four staff roles by default) with `require_min_rank(AREA_MANAGER)`, and `_load` scopes the
ticket by territory. An AM who does not cover the ticket's state cannot load it; if no AM covers
that state, no AM can, so the RH is automatically the lowest rank able to act — the chain falls out
of rules that already existed. `TicketDetailOut.penaltyReviewer` NAMES the responsible person via
`core.coverage.nearest_manager_for(require_phone=False, include_admin=True)`; it limits nobody.

**A reversal is a new row, never an edit.** `ledger_entries.kind = 'reversal'` with `reverses_id`
naming the penalty — the table's own rule ("a correction is a NEW entry"). The penalty keeps saying
what was charged. `uq_ledger_entries_reverses` (partial unique on `(company_id, reverses_id)`) is
what makes it *once*: the service checks in words, the index settles the race, and both answer
409 `PENALTY_ALREADY_REVERSED`. The self-FK is composite, so `(company_id, id)` gained a UNIQUE.

**Every reader treats a reversed penalty as never charged, and each had to be taught.** A new kind
is invisible to anything that reads `totals.get("penalty")` by name, which is all of them:

| Reader | What it does with a reversal |
|---|---|
| `core.ledger.charged_this_month` (the monthly cap) | skips reversed penalties, keyed on the PENALTY's month — an October reversal of a September charge frees September |
| `core.ledger.pool` | `reversal` is in `POOL_KINDS`; `penaltiesCollectedPaise` and `cancellations` are NET of it, so `collected − bonuses = balance` still holds and the console's sum line survives |
| `features/earnings` | leaves out both the reversal and the penalty it names (`_shown()`), so the technician's screen needs no new copy and no rebuild |
| `features/ledger` | lists reversal rows; `LedgerEntryOut.reversed` tags the charge |

`core.ledger.not_reversed()` is the one predicate they share. The cancel path's profile row lock is
taken here too, so a reversal and a new charge against the same cap cannot interleave.

`jobs_cancelled` is NOT decremented: the cancellation still happened; only the money came back.

The technician is pushed `{"type": "job"}` with **no ticket id** — the app refreshes earnings on
any `job` push but routes a tap only when an id is present, and the technician who cancelled no
longer holds that job (`/job/:id` would 404). A `job.changed` frame refreshes an open screen.

⚠ **The downgrade of `e8b2f47c19d3` refuses while any reversal exists.** Deleting one would silently
re-charge a technician, so it stops and says how many — the `f4b28d1a67c3` shape.

## GSTIN lookup — where a vendor's details come from

`POST /vendors/gstin-lookup` asks **GSTZen's GSTIN Validator** what the GST registry holds for a
GSTIN, and the console fills the vendor form from it: name, PAN, GST company status, and the
registered address. `app/integrations/gstzen.py` owns the call; `RequirementDocs/GSTRequest.txt`
is the provider's contract.

**`status` and `valid` answer different questions, and conflating them is the bug to avoid.**
`valid: false` is about the GSTIN — not registered, and the console blocks the save.
`status: 0` is about **us** — the subscription is spent or lapsed — and blocks nothing at all.
With the local check below that makes **four** outcomes, never two:

| `outcome` | Means | Reached the registry? | Console |
|---|---|---|---|
| `found` | registered | yes | fills the form |
| `already_registered` | **we** hold it | **no** | blocks the save |
| `not_registered` | a real refusal | yes | blocks the save |
| `unavailable` | we could not ask | tried | blocks **nothing** — everything stays typeable |

Same degradation rule as WhatsApp and ACS: **leave `GSTZEN_TOKEN` empty and nothing 500s.** The
lookup reports itself unavailable and the form is typed by hand, exactly as before it existed.
Which also means a deploy that forgets the variable looks like a working build with a form that
has quietly stopped filling itself in — set it in the Azure App Service settings, not only in
`api/.env`.

**Every call spends a unit of a metered subscription.** Hence four guards worth keeping. The
request is refused with a 422 before it leaves this process unless the GSTIN is well-formed
(`GstNumber`, shared with companies). The console holds each answer with `staleTime: Infinity`
under its own `gstin-lookup` query key — deliberately outside the `vendors` prefix, so saving a
vendor does not evict what the registry said and buy it again. On an EDIT the console does not
ask at all until the number differs from the saved one: the autofill only ever fills empty boxes,
so opening a vendor to change its phone would buy an answer with nothing to do. And, first of all:

**Our own tables are asked before the registry is.** A GSTIN we already hold cannot be saved —
`assert_gstin_free_for_*` 409s on it — so buying the registry's opinion of it spends a unit on an
answer nobody can act on, and the operator finds out only after filling the whole form in.
`app/core/gst.py` answers "who holds this?" and, when somebody does, the lookup returns
`already_registered` **without calling out at all**. It carries the same `code` and the same
sentence the 409 would, because that module writes both — the pre-check and the save can no longer
word the same refusal differently. The 409 stays as the backstop for a race and for anything
calling the endpoint directly; this is a spend and a courtesy, not the guard.

Two things about that check are not interchangeable, and `app/core/gst.py` argues both:

- **The two surfaces have different SCOPE.** `/vendors/gstin-lookup` asks only within the caller's
  own tenant — this company's vendors, and this company's own number. It must never ask
  platform-wide, because naming another tenant would tell a company admin which companies exist.
  `/companies/gstin-lookup` does ask platform-wide, and naming the holder leaks nothing: its caller
  is a superadmin, who can already list every company.
- **`excludeId` is the row being EDITED**, and without it every edit dialog refuses its own GSTIN
  and names the row on screen. A vendor id on the vendors route, a company id on the companies
  route — on the latter it doubles as the answer to "whose vendors?", which is why a company being
  *created* skips that half entirely (it has none).

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
body takes exactly two parameters — the company, then the link (`technician_invite`, approved).
Pointing it at an unrelated approved template sends that template's words, not an invite. With it empty the code falls back to free-form text, which
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

### `slot_rescheduled` is APPROVED and live

Submitted to Meta on **2026-09-07**, template id `2208058859762917`, UTILITY / `en_US`, and
**APPROVED the same day**. `WHATSAPP_SLOT_RESCHEDULED_TEMPLATE_NAME=slot_rescheduled` is set in
both `.env` files and deployed; `publish.py` now counts ten approved templates instead of nine,
which is its own independent confirmation.

Proved by sending one, not by reading the status: a wrong parameter count is Meta error `132000`
and nothing but a real send finds it. Sent to `+916301815418` — one of the two numbers on
`WHATSAPP_ALLOWLIST` — and accepted with a message id.

⚠ **Nothing tells you when Meta says yes.** `job_accepted` and `job_accepted_manager` were approved
and sat empty in dev's `.env` for two days, silently dropped with 131047, because filling the name
in is a manual step nobody is prompted to take. `publish.py` guards only the opposite direction —
a CONFIGURED name that is not approved. Check with:

```bash
curl -s -H "Authorization: Bearer $WHATSAPP_TOKEN" \
  "https://graph.facebook.com/v21.0/$WHATSAPP_BUSINESS_ID/message_templates?fields=name,status&limit=200"
```

The body as registered — four parameters, opening with "Your" and closing on a fixed sentence for
subcode `2388299`, and matching the `Your {{2}} … from {{1}}` shape Meta has already approved four
times here:

```
Your {{2}} visit from {{1}} has been moved.

It was {{3}}. It is now {{4}}.

Our technician will call you before arriving.
```

Parameters in order: company, product, the PREVIOUS window, the new one. Naming the previous one
is the whole point — a second message reading "your visit is confirmed for…" beside the first
leaves the customer unable to tell which is current, which is why this is its own template rather
than a re-send of `slot_confirmed`.

### `technician_app_link` — a DIRECTLY added technician gets the app link

`create_technician` WhatsApps the new technician where the app is, the way an invite does, and
"Send app link" on a registered row (`POST /technicians/{id}/app-link`, `technicians.create`) sends
it again. Three decisions in it:

- **The link carries no token.** It is `INVITE_LINK_BASE` itself (`technicians.service.app_link`):
  the installed app's App Link already claims `/invite`, and `app/(auth)/invite/index.tsx` sends a
  tokenless visit to sign-in — so no mobile rebuild. A phone without the app lands on
  `GET /invite`, the invite landing page's tokenless twin, which offers "Open the app" and the
  download. That page exists only once the API is deployed; until then a browser gets a 404.
- **Sent after the commit, and reported rather than stored** — `users.create_user`'s order and
  reasoning. An invite keeps its delivery on its own row because the invite IS the record until
  somebody registers; a direct technician's record is complete without it. `appLinkStatus`,
  `appLinkError` and `appLink` ride on the create response and the resend, and the console's toast
  is all there is of them. No migration.
- **Its own template, not the invite's.** `technician_invite` says "complete your registration" and
  "this link is personal to you", both wrong for somebody a manager already registered.

⚠ **The template is NOT approved.** Submitted 2026-09-10 as UTILITY / `en_US`, id
`2131819437688748`, and rejected `INCORRECT_CATEGORY` — twice: once as "You have been added as a
service technician with {{1}}. Install the technician app and sign in with this mobile number:
{{2}}…", and again after editing it into an account notice ("Your service technician account with
{{1}} has been created. Sign in with this mobile number to see your jobs: {{2}}…"). Meta's
classifier reads both as MARKETING. `WHATSAPP_APP_LINK_TEMPLATE_NAME` is therefore EMPTY in both
`.env` files, and the send falls back to free-form text — accepted by Meta, and delivered only
inside the 24-hour window. The ways forward are a review request in WhatsApp Manager, a MARKETING
submission (dearer per message), or reusing `technician_invite` with its wrong words. Whichever
body is finally approved, make `build_app_link_payload`'s fallback say the same thing, and add the
name to `publish.py`'s must-be-set list only after it is APPROVED.
