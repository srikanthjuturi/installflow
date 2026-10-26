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

**Every company runs franchisees, and a franchisee runs the technicians.** `franchisees` (one **home** per
company, owning every pincode nobody else claims, plus internal and external ones given pincode ranges),
`franchisee_pincodes`, a third family of logins (`franchisee_admin`, `facility_admin`, `facility_operator`) in a
restricted `/franchise/*` portal, **employees** beside freelancers, a **travel** and a **speed** allowance, **spare
parts** with the `Awaiting Part` status, a manual **technician transfer** and a staff **ticket hand-over**. Tickets
stay company work; technicians and their money are the franchisee's (F7), and every technician rupee carries the
franchisee that paid it (`ledger_entries.franchisee_id`). Read, in order: "Franchisees", "Ranges and the
carve-out", "Franchise principals", "`accept_snapshot`", "Travel allowance", "Base location", "Speed allowance",
"Spare parts", "Employee statements", "Moving a technician" and "Handing an unassigned ticket" — and hard rule 2's
trap about stacked guards before adding a route to any of them.

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
entered, clamped to the ticket's price and writing no row at zero. **An employee's closure writes
none (Task 06, T2)** — they are salaried, so `core.employment.job_technician_type` +
`pays_per_job` gate both writers and a force close appends `· no per-job payout: employee` to the
event note; bonuses, penalties and reversals still flow exactly as for a freelancer (T3). See
**Employee statements** below. `LEDGER_KINDS` also carries `travel`, `speed_reward` and `speed_penalty` since
Tasks 10/11 — `travel` is the technician's money like a payout, the two speed kinds are POOL kinds
(`POOL_KINDS`, `REVERSIBLE_KINDS`, `CAPPED_KINDS` and `SPEED_KINDS` live in `models/ledger.py`); see
**Travel allowance** and **Speed allowance**.

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
- **The pool is one PER franchisee** (Task 05, F12): every penalty/bonus/reversal row is stamped
  with its technician's `franchisee_id` inside the write, and `core.ledger.pool` now REQUIRES a
  franchisee id — `pool_arithmetic` derives
  `balance = collected − bonuses` from the grouped totals of exactly that franchisee's rows, and
  the console prints `collected − bonuses = balance` against ONE franchisee's figures. There is
  deliberately no "all franchisees" total. A read resolves whose pool from the caller via
  `core.franchise_money.pool_franchisee`: a franchisee principal gets its own wall-pinned one;
  staff name `?franchiseeId=` when they want another (Admin/NH for the ledger entries — an AM or
  RH may read the BALANCE of any franchisee but cannot open its rows — home when absent, 404
  "Franchisee not found" unknown). On `/franchise/ledger/pool` the franchisee sees its own,
  stamped on every row (`franchiseeId`, `technicianType`).
- **`net = earned + bonuses − penalties`**, in one grouped query in `earnings.summary`, so the
  three tiles and the hero figure cannot come from different reads. It may be negative.

Still to come: **AI review** and the **dashboard**.

**A technician redeems their balance by UPI — the payer claims, the technician confirms.**
`features/redemptions`, tables `redemptions` + `redemption_events`. There is no gateway: the server
builds the `upi://pay?…` string (`core.upi.build_upi_uri`), both clients draw the QR themselves,
and the payer pays from their own phone. Nothing here can see money move, so what is recorded is
two people's word, kept apart:

- The **payer** — the company's National Heads, or its Admins when it has none
  (`core.coverage.payer_role`) — **claims** "I paid" with a screenshot (required, a private
  `attachment/<company>/` blob) and a UTR (optional). A claim can repeat; the row holds the latest,
  the events hold every one.
  **For a HOME technician's redemption, that is the whole story** (F8, unchanged). A NON-home
  technician's redemption is money of THEIR franchisee: `redemptions.franchisee_id` is stamped at
  request, it rings `audience='franchisee_admin'` and that franchisee's own admin pays it
  (`franchise.payouts`, R3's no-fallback ruling) — the company's payer hears nothing of it and
  cannot claim it (a claim attempt is a 404 through the scoped loader, never a 403). Both read the
  same rows and both are told who may act: staff shape rows read `canAct` (false for any staff
  caller on another franchisee's rows) and `payerLabel` names the audience — "National Head" or
  "Franchisee Admin" (`redemption_audience(is_home=…)`).
- **The wall and the doors are one pair.** Staff keep their two list/detail/
  claim/decline routes with `require_staff_principal` (Task 05); the franchisee's own admin has
  the `/franchise/redemptions…` twin — list (`_payer_scope`, own rows only — a company-wide row
  never reaches it), `/count`, detail and claim/decline. There is deliberately NO confirm
  endpoint on either door: the technician confirming is the one thing that pays, unchanged.
- The **technician confirms** it arrived. **`confirmed_at IS NOT NULL` is what "paid" means**, not
  a status value, and there is no endpoint that marks a redemption paid any other way — an admin
  confirming would be inventing a fact. "Not yet" writes a `denied` event and rings the payers; it
  changes nothing else.
- **Only the payer declines, and only before claiming.** The technician has no cancel: a payment can
  leave the payer's phone at any moment after the QR is up, and a cancel landing meanwhile would free
  the balance for the same money to be asked for twice.
- **The amount is the server's, frozen** — `credited − reserved`, capped at `UPI_MAX_PAISE`
  (₹1,00,000, the UPI per-transaction limit). `credited` is `core.ledger.credited`, sharing
  `shown_to_technician()` with the Earnings screen so the two can never disagree; `reserved` is every
  redemption not declined. The request body carries the figure the app SHOWED, and a mismatch is 409
  `BALANCE_CHANGED`, never a request for a sum nobody saw. The UPI ID and name are frozen on the row.
- **One open redemption per technician** (`uq_redemptions_one_open`), and nothing auto-confirms on
  silence, for `sweep_force_close`'s reason.
- **Not a ledger row.** `ledger_entries.ticket_id` is NOT NULL, installed APKs crash on an unknown
  ledger kind, and a withdrawal inside a week would make the Earnings net read as a week of no work.
- ⚠ **`pa` is never percent-encoded.** BHIM, PhonePe and Paytm read `pa=name%40bank` literally and
  refuse it; Google Pay decodes it, which hides the bug from anybody testing on GPay alone. Test a
  change to `build_upi_uri` on BHIM or PhonePe.

**Employees cannot redeem (Task 06, T4) — and the balance they would have redeemed is the
FREELANCER stream only.** `POST /redemptions/me` answers 409 `EMPLOYEE_CANNOT_REDEEM`
("Employees are paid through salary, so there is nothing to redeem.") before the open-redemption
guard, because a person who cannot be paid by UPI has no business in the queue at all;
`GET` still answers 200 with `canRedeem: false` + `technicianType` so the app hides the redeem
sheet instead of discovering the refusal. Behind both:
`core.ledger.redeemable_balance = credited(company, technician) − reserved`, where `credited`
now filters to rows stamped `technician_type = 'freelancer'` — every ledger row says which stream
it moved under at write time (Task 05 §3.3), so one table answers "redeemable" and "salary
statement" from the same rows, and a technician who switched types mid-life has their money in
exactly the stream it was earned under.

## Employee statements — one CSV file per employee per month (Task 06)

`GET /franchise/statements/{technicianId}?month=2026-10` for the franchisee's own admin
(`require_franchise_principal` + the `franchise.statements` feature), and the home staff twin
`GET /ledger/statements/{technicianId}` (`earnings.view` + a **National-Head floor** — money on
home employees is the company's least-shared read). Both share `core/statements.py` and return
the FILE, not an envelope: success is the raw CSV with a UTF-8 BOM, an attachment
`Content-Disposition` filename `statement-<franchisee>-<technician>-<yyyy>-<mm>.csv`, and any
failure uses the ordinary envelope — the console reads it with `apiGetBlob`. The month is
`?month=2026-10` (422 `BAD_MONTH` otherwise, and for one that has not started). What it holds:

- **The month is WRITTEN, never restated.** Rows land in the month the money moved, a reversal
  is a line of the month it was GIVEN BACK (its `Reverses` column naming the penalty and the
  date it carried), and a re-download is byte-identical — that is what lets payroll trust it.
  (The technician's Earnings screen reads the same rows as "never charged"; the statement reads
  them as a written line that later got a credit. Different questions, both honest.)
- **Kind-generic.** Rows are selected with `kind <> 'payout'` (T2), `KIND_LINES` rules each
  kind's sign and title, every ruled kind still gets a total line at zero when the month has
  none, and an unruled kind is LISTED — its own row with *"unrecognised item — not in the net"*
  beside each amount — but is kept OUT of the net and logged. Hidden money is worse than
  unsummed money, and `test_statements`' coverage gate fails the build when Task 10/11 add a
  kind without teaching the statement about it.
- **The wall is two clauses, either suffices:** the technician is an employee OF THAT franchisee,
  or they carry employee-stream ledger rows in the month. Everything else is 404 "Statement not
  found" — including a freelancer (never an employee, nothing to state) and another
  franchisee's people, the same way every money read walls.
- **Every cell goes through `csv_safe`** — a leading `= + - @` or tab gets an apostrophe the
  spreadsheet hides, because payroll opens this file in one. Amounts are plain two-decimal
  rupees, no thousand separators and no currency column to argue with.

**A UPI ID is added once, then changed by request** (`b7d2c9e41f60`). The technician adds it on
`POST /technicians/me/payout-account/code` → `POST /technicians/me/payout-account`, with the name
on the account (`technician_profiles.upi_name`) and a code to their own registered number
(`otp_codes.purpose = 'payout_account'`; the 401 from `consume_code` is translated to 400
`BAD_CODE`, as reschedule does). Refused with 409 `UPI_ALREADY_SET` once one is on file. After
that, `POST …/change-request` creates a `upi_change_requests` row (one pending per technician)
addressed to `core.coverage.upi_reviewer`'s role — the AM whose states cover one of the
technician's pincodes, else the RH of one of their regions, else a National Head, else an Admin —
and `POST /technicians/{id}/upi-change/approve|reject` decides it (`technicians.edit` + an
Area-Manager floor, territory-scoped through `_load`; any manager who can edit the technician may
act, whoever's bell rang). **Task 05 splits it by whose technician it is (F7/F8):** a NON-home
technician's reviewer is its own franchisee's admin — `reviewer_role='franchisee_admin'`, the bell
carrying `audience='franchisee_admin'` + the row's `franchisee_id` — decided on the `/franchise`
twin's `POST /franchise/technicians/{id}/upi-change/approve|reject`, queued on
`GET /franchise/upi-changes?state=pending` and counted on its `/count` (R3's no-fallback ruling:
no staff role decides it, and only an admin of THAT franchisee can). The home keeps the
AM → RH → NH → Admin chain above. `GET /technicians/me/payout-account` names it for the app:
`reviewerLabel: "Franchisee Admin"`. The old free `PATCH …/payout-account` now answers 409 `UPDATE_APP`;
joining ignores a `upiId` if an old build sends one; the console's add/edit still sets it directly,
no code — a manager IS the check. A redemption's payee name is `upi_name`, falling back to the
technician's own. Each redemption still freezes the address it was asked with.
⚠ The OTP throttle is per PHONE across purposes, so a code asked for within `OTP_RESEND_SECONDS`
of signing in is a 429. Normal in tests, never in use.

**Credits — a company pays for tickets, and recharges by UPI to the platform** (`e4b9d2a7c1f8`).
`models/credits.py`, `core/credits.py`, `features/credits` (two routers: `/credits` for the company,
`/platform` for the superadmin).

- **`platform_settings` is ONE row belonging to no company** (`id = 1` by CHECK), and is in
  `GLOBAL_TABLES` for that reason: free credits, credits per ticket, the minus limit, the minimum
  recharge, and the platform's own UPI ID and name. Defaults live in `PLATFORM_DEFAULTS` and
  `load_platform_settings` rebuilds a missing row — `rules.load_rules`'s shape.
- **The balance is summed, never stored.** `credit_entries` is append-only (`free`, `ticket`,
  `recharge`; unsigned `credits`, `kind` carries the direction, as `ledger_entries` does), with
  partial uniques that make one charge per ticket, one credit per recharge and one gift per company
  structural rather than careful.
- **The charge is at CREATION** — `tickets.service.create_ticket` calls `charge_ticket` right after
  the ticket's flush, inside its transaction, so a refusal (409 `OUT_OF_CREDITS`) rolls the ticket
  and its code back and a charged ticket can never exist without its entry. Never refunded.
  `GET /tickets/intake-status` tells a vendor `{paused}` and nothing more.
- **Serialised with `pg_advisory_xact_lock`, keyed on the company — NOT `SELECT … FOR UPDATE` on
  `companies`.** `FOR UPDATE` conflicts with the `KEY SHARE` lock every foreign-key insert takes on
  its parent, so holding it would stall every write to every tenant table for that company while a
  ticket was raised. Tested: two tickets racing for the last charge above the floor — exactly one
  lands, and the balance stops on the floor.
- **Bells ring at the crossing, never per ticket** — `credits` when the balance first reaches zero,
  and when a ticket leaves too little for the next (only the second when one ticket does both).
  **A REFUSAL rings too**, because a company can reach the floor with no ticket crossing it — the
  superadmin raises the charge or lowers the limit — and then the first anybody heard was a vendor
  turned away. That bell is written in its OWN session (`_ring_refusal`), since the refusal rolls the
  ticket's transaction back; it is deduped on the paused title for 12 hours, so a vendor retrying all
  afternoon rings once, and it swallows its own errors so it can never turn the 409 into a 500.
- **A recharge is two people's word**, as a redemption is: the company CLAIMS (UTR required,
  screenshot required, an `attachment/<company>/` blob with no `..`), and only the superadmin
  CONFIRMS, which is the one thing that adds credits. Reject is final and needs a reason; the company
  may cancel only before claiming. One open recharge per company. The platform's UPI ID and name are
  frozen on the row — so a to-pay recharge started before the superadmin changed the UPI ID still
  shows the OLD one; cancel it and start again. The outcome rings `recharge`.
- **One UTR buys credits once.** A UPI payment has one UTR, so the same UTR on a second recharge is
  either a resubmission after a rejection (allowed — the rejected one never credited) or the same
  money claimed twice. `uq_credit_recharges_credited_utr` (partial on `confirmed_at IS NOT NULL`)
  makes the double credit impossible; the service says so first — 409 `UTR_ALREADY_CREDITED` on the
  company's claim (checked against its OWN recharges only, so it learns nothing about another
  company's payments) and on the superadmin's confirm (any company). The superadmin's detail carries
  `utrAlsoOn`, every other recharge with that UTR, which the console shows as a warning.
- **A payment that does not match — short, over, or to the wrong account — is REJECTED**, with the
  reason. There is no partial credit and no refund path in the product; money that left somebody's
  account is settled outside it.
- **The superadmin has no notifications feed** — a notification belongs to a company. Their bell
  and badge read `GET /platform/recharges/count` and `/waiting`, polled; a waiting recharge leaves
  it when decided.
- **`audience='billing'`** is Admins AND National Heads together — either may recharge, so both
  hear the balance and the outcome. It is in all three audience readers (see the note on
  `notifications.audience` below).
- Free credits are a one-time gift stamped at `create_company`, so changing the figure re-gifts
  nobody; the charge and the floor are read live, so a change reaches every company at once. The
  migration gave every existing company 1000, and its downgrade refuses once anything was charged or
  a recharge exists.
  ⚠ **Migrate production, then publish PROMPTLY.** A company created by the OLD code in between gets
  no gift (the old `create_company` never calls `grant_free`), and then starts at 0 with the charge
  already live the moment the new code ships. After publishing, this is safe to run any number of
  times — `uq_credit_entries_company_free` makes a second gift impossible:
  ```sql
  INSERT INTO credit_entries (company_id, kind, credits)
  SELECT c.id, 'free', s.free_credits
  FROM companies c CROSS JOIN platform_settings s
  WHERE s.id = 1 AND s.free_credits > 0
    AND NOT EXISTS (SELECT 1 FROM credit_entries e WHERE e.company_id = c.id AND e.kind = 'free');
  ```
- **The superadmin hears a claim only while the console is open** — the bell polls every 30 s and
  there is no socket, email or push for a superadmin. A claim made overnight waits for somebody to
  look. Deliberate for now; say so before promising a turnaround.

**Vendor credit — a VENDOR pays its company for the jobs it raised** (`b8e3f14a9c27`).
`models/vendor_credits.py`, `core/vendor_credits.py`, `features/vendor_credits` (two routers:
`router.py` for the vendor, `staff_router.py` for the company).

`product_models.vendor_price_paise` had been stamped onto every ticket since intake existed, and
its own comment called it "what the vendor is charged for asking" — but nothing had ever charged a
vendor. The technician's half of that pair becomes a `payout` on closure; the vendor's half went
nowhere. This is the other half, and it shares **no table** with the credits above: those are what
the COMPANY pays the PLATFORM for a ticket entering the system, charged at creation. This is what a
VENDOR owes the COMPANY for work delivered, charged at closure and cleared by paying.

- **A credit LINE, not a wallet.** `vendors.credit_limit_paise`, stamped at creation from
  `company_rules.vendor_credit_limit_paise` (₹5,000). Stamped, not read live, so raising the house
  default never silently extends a vendor somebody already agreed a different number with.
- **Four numbers, and only one of them can fall:**
  `available = limit − used − reserved`, where `used` is `Σcharge − Σpayment` over
  `vendor_credit_entries` and `reserved` is `SUM(vendor_price_paise)` of that vendor's
  non-terminal tickets. Closing a ticket moves its price from `reserved` to `used`, so `available`
  does not move — and a force-closure billed at less than full price moves it UP. Cancelling frees
  the reservation and bills nothing. **The only thing that reduces a vendor's room is raising a
  ticket**, which is why the gate and both bells live in `assert_within_limit` and nowhere else.
- **Reserving open tickets is the whole point.** Without it a vendor with ₹200 of headroom could
  raise ten ₹1,500 jobs, every gate passing, and the overshoot would surface one closure at a time.
- **Closure NEVER refuses, and that is load-bearing.** The customer's confirmation runs with no
  principal and a force-closure is a manager settling a case; neither may be blocked by what a
  vendor owes. So `used` may pass `limit` and `available` may go negative — which is exactly what
  then stops the vendor's NEXT ticket. There is no floor and no minus limit here.
- **The gate is called AFTER the ticket is flushed**, in `create_ticket` right after
  `charge_ticket`, and in `import_service._commit` right after `charge_tickets`. The new ticket is
  already inside `reserved` by then, which is what makes the check exact and what closes the race;
  the ticket row IS the reservation, so nothing separate is written. Ordering it before the flush
  would let a single job of any size through a line with one rupee left. Tested end to end: with
  the line shut, `POST /tickets` answers 409 `VENDOR_OUT_OF_CREDITS` and **no ticket, no company
  credit and no advance of the ticket code counter survives** — the company is not billed for a
  ticket the vendor gate refused.
- **`GET /tickets/intake-status` now says WHICH gate** — `{paused, reason: "company"|"vendor"|null}`.
  The company half stays a bare boolean (its balance is not its vendor's business); the vendor half
  names itself so the banner can offer the remedy that works. When both are shut the reason is
  `company`: settling what the vendor owes would not lift a company-level pause.
- **A payment is two people's word**, as a recharge is one level up. The vendor CLAIMS (UTR
  required, screenshot required, an `attachment/<company>/` blob), and only an **Admin or National
  Head CONFIRMS**, which is the one thing that restores headroom. Reject is final and needs a
  reason; the vendor may cancel only before claiming. One open payment per vendor. The COMPANY's
  UPI ID and name are frozen on the row, so changing them never moves a QR a vendor is looking at.
- ⚠ **`vendor_payments.amount_paise` is deliberately NOT restricted to whole rupees**, which is the
  opposite of `credit_recharges.amount_paise` beside it. There one credit IS one rupee, so a
  fraction would buy part of an indivisible thing. Here the amount is a DEBT, and a debt is whatever
  the tickets came to — `vendor_price_paise` carries only `> 0`, so a vendor can owe ₹3,200.50. The
  constraint was copied across at first and made that last 50 paise **unpayable**: the largest
  allowed payment left it behind, `maxPaymentPaise` went on reporting it, and every request for it
  was refused, leaving a line permanently short by an amount nobody could clear. UPI is fine with
  paise — `core.upi.format_amount` already renders them as the two decimals `am=` takes.
- **Staff can RECORD a payment that did not come by QR** —
  `POST /vendor-credit/vendors/{id}/payments`, `vendor_payments.source = 'staff'`.
  The QR flow only covers UPI, and UPI caps one transfer at ₹1,00,000; without this
  a vendor settling ₹5,00,000 by RTGS — which is how most B2B settlement here
  moves — had no way to have it credited, and neither did a cheque or cash. Their
  only remedies were five separate QR payments, or a limit increase, which records
  a credit decision in place of a payment that happened.
  - **`source` decides which rules the row obeys**, and is set at INSERT so it can
    never be inferred wrongly from who claimed. `vendor` → capped at the UPI limit,
    and a claim needs the UTR AND the screenshot. `staff` → uncapped, born claimed
    AND confirmed, needing neither, with `method` and `received_on` required
    instead. Five CHECKs carry that split; `claim_complete` became two.
  - **It is ONE person's word, and that is the two-people rule applied honestly
    rather than bent.** A bank statement is the only evidence such a payment leaves
    on our side, and the vendor — who has told nobody — is not a second observer
    waiting to be asked; asking them to "claim" a transfer they already made would
    be theatre. What matters is that the trail SAYS which kind of evidence it was,
    which is what `source` is for and what both screens print.
  - **`upi_id` / `payee_name` are NULL on a staff record**, which is why they are
    now nullable: money that arrived by NEFT went to no UPI address, and filling
    them from the company's settings would assert a route it never took. It also
    means **a company that has never set a UPI ID can still clear a line**, which
    is most of the point.
  - **`received_on` is the day the money ARRIVED**, not the day somebody wrote it
    down. A Friday transfer noticed on Monday is three days apart, and the
    statement it is reconciled against is ordered by the former.
  - It may **exceed what is owed**. An advance is a real thing, and `used` then
    goes negative — which the screens read as "in credit" rather than as a negative
    debt. `maxPaymentPaise` clamps at 0, so the vendor cannot pay on top of it.
  - Final the moment it is written, as confirming a vendor's payment is. There is
    no reversal in this product.
- **One UTR settles once, scoped to the COMPANY** — `uq_vendor_payments_credited_utr` is partial on
  `confirmed_at IS NOT NULL` and includes `company_id`, unlike the platform's global twin: there the
  payee is always the platform, here it is the company, and a vendor paying two of them must not
  look like double-claiming.
- **The other way out is a bigger line.** `vendor_credit_requests`, one pending per vendor, decided
  by the same two roles — and `granted_limit_paise` may be LESS than was asked, the judgement a
  force-closure's payout already is. Approving writes `vendors.credit_limit_paise` in the same
  transaction as the decision.
  ⚠ **It may NOT be less than the line the vendor already has**, and that is checked against the
  LIVE limit rather than the `current_limit_paise` frozen on the request, which goes stale if
  somebody raised the line while it waited. An Admin may of course cut a line — on the Vendors form,
  where it reads as what it is. Doing it through Approve would write `status = 'approved'` over a
  reduction, and a year later nobody reading the trail could tell a grant from a cut. 422 `BAD_AMOUNT`.
- **`audience='vendor'` is new, and it is the one audience that narrows AWAY from staff.** A row
  carrying `vendor_id` and no audience is also unaddressed, so it reaches every staff reader too —
  harmless for a one-sided announcement, wrong the moment an event is announced to BOTH sides as
  two rows, which these three kinds are (a row carries one `to`, and the two sides go to different
  screens). It is in all four readers: `notifications.service._visible` (no clause needed — no staff
  role is spelled "vendor"), `core.coverage.users_notified_by`, and `tickets.ws.hears_notification`,
  where it is tested BEFORE the guard that refuses every addressed row to a vendor.
- **Bells:** `vendor_credit` (the line ran out, or a ticket was refused), `vendor_payment`,
  `vendor_credit_request`. The refusal rings in its OWN session, fired as a task, because the
  refusal rolls the ticket's transaction back and a bell added to it would vanish with it — and
  `DB_MAX_OVERFLOW` is 0, so awaiting it would wait for itself. Deduped on **`(kind, vendor_id)`**
  for 12 hours, NOT on the title: one vendor retrying all afternoon rings once while another
  vendor's refusal still rings, and a crossing bell already rung counts.
- **Force-closure bills the vendor the manager's number**, clamped to the ticket's stamped
  `vendor_price_paise` — `ForceCloseRequest.vendorChargePaise`. Independent of
  `technicianPayoutPaise` and nothing couples them: a technician who travelled and found the door
  locked is owed something while the vendor is billed nothing, and a visit that happened but was
  never confirmed is the reverse. `0` and omitted both bill nothing and write no entry — a body that
  never mentioned the field came from a client that has never heard of it, and inventing a bill from
  silence is the one mistake here that takes somebody's money.
- **`companies.upi_id` / `upi_name`** is where a vendor pays, set on Configuration → Rules by
  `vendors.credit` + a National-Head floor (`GET`/`PUT /settings/payment-account`). On `companies`
  and deliberately NOT in `company_rules`: that table is stamped onto every ticket's
  `rules_snapshot`, and a UPI address is not a term of a job.
- **`vendor_credit_limit_paise` is the second entry in `rules._COMPANY_ONLY_KEYS`**, beside
  `cancel_penalty_cap_paise`. No product node may override it: a line is one number a vendor draws
  down across everything it raises, so a televisions answer and an air-conditioners answer could not
  both be it. It is also the one rule nothing reads from a snapshot — it is stamped onto the vendor.
- ⚠ **The migration gives each existing vendor ₹5,000 PLUS what its open tickets already commit**,
  and leaving that out would have shipped a day-one outage: `reserved` is a live sum, not a
  backfill, so a vendor holding a hundred open jobs would start with all of them reserved against a
  line that has never seen a payment. On the development database that was four vendors out of six,
  one by a factor of six hundred. Nothing is owed — no closed ticket is billed retroactively,
  because there is no honest way to tell a vendor after the fact.
- ⚠ **The ceiling is ₹1 crore, not the ₹10 lakh it started at.** Like
  `cancel_penalty_cap_paise`'s, it is a typo guard rather than a policy, so it has to sit above any
  plausible figure — a distributor with 1,688 open installs at ₹1,850 commits ₹31 lakh, and the
  development database already had one. A ceiling a real business can reach refuses real work.
- `core/money.py` is new: one `rupees(paise)` for the sentences a bell or an error carries, Indian
  grouping, with the ₹ symbol and a real U+2212 minus. `features/credits/service._indian` now
  delegates to it rather than keeping a second copy of the grouping algorithm; `redemptions`' own
  `_rupees` deliberately does not, because the two disagree at exactly `UPI_MAX_PAISE` and that
  value is on a signed-off screen.
- ⚠ **A vendor's SUB-USER hears these bells and cannot open them.** `vendor.credit` is seeded to
  `vendor` and not `vendor_user`, but `_visible`'s vendor branch matches on `vendor_id` and ignores
  role, so a sub-user gets the row and `RequirePortalFeature` then redirects them to
  `/portal/tickets`. Pre-existing rather than new — `_notify_brand_decided` sends a
  `vendor.catalogue`-gated `/portal/brands` the same way — and the information still reaches them,
  on the paused banner over the ticket form. Fixing it means splitting the read from the act, for
  every vendor-addressed kind at once.

**A slot can move**, which is what finally clears the escalation queue's missed half. Two doors move
it through one mover in `core/reschedule.py` (a third, the customer's link, only ever books a
first time through it — below) — the technician's, gated by a one-time code sent to the
**customer's** phone (`otp_codes.purpose = 'reschedule'`, keyed on `ticket_id`) and read back to
them; and the console's, `jobs.reschedule` + an Area-Manager floor, no code and a required reason.
Nothing is charged either way: the customer agreed.

Eight things about it are load-bearing:

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
  Only the technician's door with a code that reached somebody else may SAY the customer
  confirmed — the `rescheduled` bell, the trail title and `slot_confirmed_at` all check
  `core.reschedule.is_own_number`, and the warning bell asks a manager to confirm with the
  customer instead (QA bug 8 read "the customer did not confirm it" as a false alarm).
- **The customer's own link is a third door, and it books through the same mover.**
  `confirm_slot` calls `move_slot(customer_agreed=True)`: a first booking by the one party whose word
  `slot_confirmed_at` records. It used to be an unguarded write of its own. That raced a technician
  accepting, leaving the ticket `New` with a technician on it, and a technician starting, which
  wrote `Assigned` over `In Progress`.
- **A time can be chosen only in `core.slots.CHOOSABLE_STATUSES`** — the assignable four, minus
  `Escalated` with a technician. Never "anything not terminal". A job accepted before its time was
  agreed can be STARTED. Its link then booked a slot and un-started it: the job showed "Start job"
  again and the no-show sweep was armed against somebody on site. `time_is_choosable` and its SQL
  twin now gate the slot page's picker, `confirm_slot`, the console's `slotLink`, both
  missing-slot sweeps and the two dashboard tiles that must match them. The expired-window sweep
  mattered most: it had been spending a started job's only `force_close` bell.

One thing nothing clears yet, deliberate and needing a product decision rather than code: the
vendor is never told their customer's slot is at risk.

## Franchisees — who runs a company's technicians (Tasks 01-03)

`franchisees` + `franchisee_pincodes` (`3b7e1f0a9c41`), `core/franchise.py`, and the management API in
`features/franchisees/` (prefix `/franchisees`; a company Admin or National Head writes, `franchisees.manage`;
an Area Manager and above reads, `franchisees.view`). Every company has exactly ONE **home** franchisee —
`uq_franchisees_one_home` (partial, `WHERE is_home AND deleted_at IS NULL`), `ck_franchisees_home_is_internal`,
`ck_franchisees_home_is_permanent` — named after the company, code `HOME`. The rest are `internal` or `external`;
a `code` is `^[A-Z0-9]{2,8}$`, stamped once at creation and never editable.

- **The home stores NO pincode rows and owns every pincode nobody else does (F4).** That is what makes a ticket
  unable to be franchisee-less, and it is why `franchisee_pincodes_subquery(company_id, franchisee_id,
  is_home=…)` is a SUBQUERY — "active master codes not in any other franchisee's rows" — and never a list (hard
  rule 3's reason). `uq_franchisee_pincodes_company_pincode (company_id, pincode)` is the no-overlap rule and
  what settles a race between two saves.
- **`core.franchise` is the one place that answers "who owns this pincode"**: `franchisee_for_pincode` (one
  probe), `franchisees_for_pincodes` (two queries for a whole sheet — the importer), `restamp_ticket`,
  `assert_pincodes_in_franchisee` and `lock_routing`. Nothing else reads `franchisee_pincodes` to route.
- **`create_company` creates the home in its own transaction** (and the two travel-rule rows with it), and
  `home_franchisee_id` repairs a company that has none — one created by the OLD code between the production
  migration and the publish. Concurrent repairs collide on the partial unique and the retry finds the row. This
  is the credits precedent, and the reason R1 is "migrate, then publish PROMPTLY": five `franchisee_id` columns
  are NOT NULL, so until the new API is live the old one cannot raise a ticket, add a technician, close a job or
  take a redemption.
- **There is no DELETE** — history is NOT NULL on five tables. `POST /{id}/deactivate` refuses with 409
  `FRANCHISEE_HAS_TECHNICIANS` while it holds a technician or a live invite (clear its pincodes first, which hands
  them back to home) and while a redemption is unsettled; then it releases the pincodes, hands back the
  unassigned tickets that were handed to it (Task 18), and switches off every franchise login it has
  (memberships, never users — a person may hold roles elsewhere). Home answers 409 `FRANCHISEE_HOME_IMMUTABLE`
  to deactivate, to becoming external, and to a range.
- **Franchise logins** live in `core/franchise_logins.py`, shared by the franchisee admins (Task 03) and the
  facility users (Task 12): an email is one identity per tenant across ALL roles; a temporary password is minted
  only for a brand-new user and mailed only AFTER the commit, never raising; if the mailbox refuses it (the
  `ACS_EMAIL_ALLOWLIST` on dev, any `@seed.example.com`) or the send fails, the password comes back in the
  response — the vendor-login pattern. The last active admin of a NON-home franchisee cannot be deactivated
  (`blocks_last_admin`, 409 `FRANCHISEE_LAST_ADMIN`): nobody else could approve its technicians' UPI changes or
  pay its redemptions. The home is exempt, because company staff hold every home authority anyway.

## Ranges and the carve-out (Task 03)

`PUT /franchisees/{id}/pincodes` (`?dryRun=true` previews) takes ranges as text: `500001-500099, 500120`.

- **The grammar is pure** — `core/pincode_ranges.py` (`parse`, `expand`, `span`, `empty_ranges`, `compress`). A bad
  token is a 422 naming it; `expand` intersects the ranges with the master's ACTIVE codes, so a range may span
  thousands of numbers and only codes that exist are stored (the response counts the rest as `unknownCount`).
- **The decision is pure too** — `core/carve_out.plan_carve_out` decides who moves, who is trimmed and which
  tickets re-route; the service only fetches coverage and owner maps and writes the answer. A technician whose
  coverage lies wholly inside the new set moves; one with some inside loses those codes; one who would be left
  with none moves instead (F6).
- **Apply order, in one transaction, under an EXCLUSIVE routing lock:** the leaving rows are deleted, the new rows
  inserted (the unique is the boundary; a lost race is one retry, then a 409 `FRANCHISEE_PINCODE_TAKEN` naming
  the clashing codes and their owners), moved technicians, trimmed ones, live invites, then the tickets. The
  ticket UPDATE stays CONDITIONAL (`technician_id IS NULL AND status IN …`, `Escalated` with nobody on it
  included), so a job accepted between the read and the write stays with its holder and its franchisee —
  assigned jobs keep both. Only RETURNED rows get a `franchisee_changed` event and a frame.
- **The routing lock is advisory and per company** (`lock_routing(db, company_id, exclusive=…)`): EXCLUSIVE for a
  carve-out and a deactivation, SHARED for intake and every coverage check, so a pool read never lands between two
  halves of a carve-out. Lock order, where several are needed: routing → credits → vendor credit. A DRY RUN takes
  no lock and rolls back — previews never queue behind saves.
- Tickets handed over by hand (Task 18) are skipped by the planner: a carve-out must not undo a person's choice.

## Franchise principals — the second wall inside a company (Task 02)

Four kinds of principal sign in: staff, technicians, vendors and **franchise users**. Their roles
(`FRANCHISE_ROLES = {franchisee_admin, facility_admin, facility_operator}`, `FACILITY_ROLES` the last two) are
ranks 8-10 — BELOW every staff role — and **rank never decides their authority**: `require_min_rank` refuses them
(a franchisee admin outranks nobody) and so cannot be the thing that lets them in, while `ensure_below_rank` is the
wrong tool for managing them. Test the set, never the number.

- **`Principal.franchisee_id` is read from the membership on every request**, never a token claim, so a franchisee
  switched off mid-session loses access at once (403 "This franchisee is no longer active"); on a staff
  membership it is ignored and stays None.
- **Two guards, two audiences.** `require_franchise_principal` / `FranchisePrincipal` is the franchisee ADMIN only —
  the owner of technicians and money (F7); `require_facility_principal` / `FacilityPrincipal` is any of the three
  (the parts desk). Each is used ALONGSIDE the route's `franchise.*` / `parts.handle` feature key, because Feature
  Access can hand any key to any role. Hard rule 2 records the stacked-`Depends` trap that once defeated the pairing; it is fixed and pinned at zero.
- **`core/franchise_scope.py` is F7/F8 in one place.** `managed_franchisee_ids(db, principal, purpose='manage' |
  'view' | 'reverse')` (None = all in the company) and `can_manage_technician`: a franchise principal manages its
  own franchisee; Admin/NH manage the HOME franchisee (and reverse a penalty anywhere); everyone else sees a
  non-home franchisee's technicians but does not manage them. **See but not manage is a 403 "Managed by …"; not
  seeing is a 404** — the scoped loader answers first.
- **A franchise caller sees tickets by OWNERSHIP (`tickets.franchisee_id`), never through `visible_pincodes`:**
  after a carve-out an assigned ticket keeps its old franchisee while its pincode moves. A facility user sees the
  tickets that have a part request. `vendorPricePaise` is withheld (null) from every franchise principal.
- **Users & roles refuses the franchise roles** (400): they are created only by the Franchisees screen (franchisee
  admins) and the portal (facility users; plus, for HOME, the Admin/NH routes under `/spare-parts/home-facility-users`).
- **A franchise principal asking for another franchisee's technician, ledger row, redemption or part request gets
  404**, exactly as for another company's. `audit_tenancy` proves the company wall only; this one is an
  application invariant the script cannot see.

## `accept_snapshot` — what depended on the technician (Task 10, extended by Task 11)

`tickets.accept_snapshot` (JSONB, camelCase) freezes, at the moment a technician takes a job: `acceptedAt`,
`technicianId`, `franchiseeId`, `technicianType`, `travel{…}` (base and customer point with their sources, km,
the rates, the computed amount, and a `reason` of `no_base_location` / `no_customer_point` when the amount is
₹0 for want of a point) and `speed` (the matched rule, or null). It exists because a rule edited next week must
never restate a job somebody already accepted (TA5/S5) — the same reason `rules_snapshot` exists at intake.

- **Written BY the guarded UPDATE that assigns the ticket** (`jobs.service.accept` and
  `tickets.service.assign_technician`), so it exists if and only if that technician won. Every path that clears
  `technician_id` (a release, a cancel, an escalation) clears the snapshot in the SAME statement; a re-accept
  stamps a fresh one.
- **`JSONB(none_as_null=True)` is load-bearing.** Without it `values(accept_snapshot=None)` writes the JSON value
  `null`, which is not SQL NULL and defeats every `IS NULL` reader.
- **Read it through `core/accept_snapshot` (`travel_of`, `speed_of`, `technician_type_of`), never with a bare
  `[]`.** A NULL snapshot means "accepted before Task 10" and pays nothing; the readers degrade to "nothing to
  pay" on a hand-patched or malformed one instead of raising.
- **`backdate.shift_ticket` moves `acceptedAt` with the timeline** (it is text inside JSONB, so no column shift
  reaches it), or a seeded job would read as accepted weeks after its own `assigned` event.

## Travel allowance (Task 10)

`core/travel.py` (pure), `core/travel_rules.py`, `core/base_location.py`, `franchisee_travel_rules`
(`9e1b5d3c7a26`): exactly two rows per franchisee, one per technician type, stamped from `TRAVEL_DEFAULTS` when
the franchisee is created and healed on read. Defaults: free 20 km (freelancer) / 30 km (employee), a 1 km step,
a 130 % road factor, **₹0 per step and ₹0 maximum, so it is off until a franchisee configures it**.

- **The arithmetic is in integer TENTHS of a km (W1)**: `road_km` rounds the straight-line metres × factor half-up
  to 0.1, and `travel_amount_paise` is `min(max, floor(max(0, km − free) / step) × rate)` — the km a technician is
  shown is exactly the km they are paid for, and a partial step is dropped.
- **A rate needs a ceiling (W2):** `paisePerStep > 0` with `maxPaisePerJob = 0` is refused at the schema, because
  that allowance would always be ₹0 and say it was on.
- **Paid on the customer's confirmation as ledger kind `travel`** (`closure_travel_paise` reads the FROZEN amount,
  and only when the snapshot names the ticket's current holder); `uq_ledger_entries_one_travel` makes a second
  row impossible. It is the technician's money, not pool money. On a **force-closure** the manager's
  `travelPaise` is pre-filled by the form with the frozen amount; **omitted means nothing** (the
  `ForceCloseRequest` doctrine), anything above the frozen `maxPaisePerJob` is clamped (`force_close_travel_paise`),
  and 0 writes no row. A cancellation pays no travel.
- **It folds INTO `earnedPaise`** (with `travelPaise` as a breakdown), never a fourth term beside it — an installed
  app's three tiles must keep adding up to `netPaise`. `core.ledger.credited()` includes the kind.
- Rules are read/written at `GET|PUT /settings/travel` (the HOME franchisee, `settings.edit` + a National-Head
  floor), `GET|PUT /franchise/settings/travel` (a franchisee admin, its own) and `GET
  /franchisees/{id}/travel-rules` (any franchisee, read-only). The API still never calls a map service: the
  distance is the straight line from `core.coordinates.metres_between`, so a "road" is a multiplier, not a route.

## Base location (Task 10)

Six columns on `technician_profiles` (`base_latitude`, `base_longitude`, `base_pincode`, `base_source`,
`base_set_at`, `base_set_by_user_id`): both coordinates or neither, inside India's box, `base_source` one of
`pincode`, `gps`, `map`, `manual`.

- **Who may send which source (W8):** a technician `pincode`, `gps` or `map`; a manager `pincode`, `map` or
  `manual` — `manual` is an office's knowledge, `gps` is a device's fix. Routes: `PUT /technicians/me/base-location`
  (the app), `PUT /technicians/{id}/base-location` (staff, HOME technicians only) and its `/franchise` twin.
- **The coordinates are COPIED onto the profile even for a pincode base (W7)**, so the point is self-contained and a
  later correction of that pincode's centre moves nobody who already has a base. A correction to a pincode centre
  would have to re-copy `base_source = 'pincode'` bases explicitly, and must never touch an `accept_snapshot`.
- **A pincode base must lie inside the technician's own franchisee for EVERYBODY, the home included (W9)** — 422
  `PINCODE_OUTSIDE_FRANCHISEE` — and must have a centre: 400 `PINCODE_HAS_NO_LOCATION`; a point outside India is 400
  `BASE_OUTSIDE_INDIA`. All three are `AppError`s the app translates by `code`.
- **Abuse is made visible, not impossible (owner ruling R9):** no approval and no cooldown; the source and who set
  it are stored and SHOWN to the franchisee admin (and home managers), who can correct it at any time; the frozen
  `maxPaisePerJob` bounds the downside, and a correction never restates an accepted job. Coordinates are returned
  ONLY on the technician-management endpoints — never on a ticket, where a technician's address would leak to
  every manager who can read it.

## Speed allowance (Task 11)

`core/speed.py` (pure), `core/speed_rules.py`, `core/speed_settle.py`, `franchisee_speed_rules` (`b4a8e2f6c903`):
a matrix keyed by franchisee × technician type × (category node OR product model), each row holding
`reward_within_hours`, `penalty_after_hours`, `reward_paise`, `penalty_paise`. **An empty matrix is OFF (W1)** —
resolution never self-heals, absence is the answer, and the snapshot stamps `speed: null`.

- **Resolution (S2):** the ticket's MODEL row wins, else the DEEPEST node row on `node_path_ids`, else none —
  keyed on the snapshot's franchisee and type, not today's. It is frozen at accept and measured at completion.
- **The clock (S3, owner ruling R1) starts at the LATER of the latest `assigned` event and `tickets.slot_start`,
  minus the time spent in `Awaiting Part`, and stops at the latest `completed` event** — `clock_start`,
  `working_hours`, `clock_from_events(events, slot_start)`. The slot is read from the TICKET (a reschedule moves
  it, so the one in force at completion counts) and passed in as data; the `Awaiting Part` spans are read off the
  `status_changed` events' `from_status` / `to_status`, which is the contract with Task 12. A slot after
  completion is 0 hours; no slot starts the clock at the accept.
- **Boundaries are compared on EXACT seconds (W4)** — ≤ `reward_within_hours` rewards, > `penalty_after_hours`
  charges, between pays nothing — so the one-decimal figure on a screen never decides money.
- **Written on the customer's confirmation only** (`speed_settle.settle_speed`, inside the closure transaction,
  after the payout and travel rows, before the commit). A force-closure pays no speed money (S5, R7). The two
  kinds are POOL kinds: `speed_reward` is paid from the franchisee's pool like a bonus, even from a negative pool
  (no balance check); `speed_penalty` funds it, counts against `cancel_penalty_cap_paise` through
  `capped_charge` taken under the technician's profile lock (so it cannot interleave with a cancellation charge),
  and is reversible like any penalty. `uq_ledger_entries_speed_once` allows one speed row per ticket.
- **The `speed_settled` event carries the hours but no rupee amount** and is hidden from vendors. Staff edit only
  the HOME matrix (`settings.edit` + a National-Head floor, the same guard as home travel); a franchisee admin edits
  its own at `/franchise/settings/speed*`, and `GET …/speed/catalogue` is the editor's two pickers, price-free.

## Spare parts and `Awaiting Part` (Task 12)

`features/spare_parts/` (prefix `/spare-parts`), `core/spare_parts.py`, `spare_parts` and `spare_part_requests`
(`d6c3a9f1e874`), plus the technician's side in `features/jobs/` (`GET /jobs/{id}/parts`, `POST
/jobs/{id}/part-requests`).

- **A job is `Awaiting Part` EXACTLY while it has a request that is `requested` or `approved`.** That is a fact
  about a SET of rows, so no single guarded UPDATE can settle it: every writer takes `lock_ticket` (`FOR NO KEY
  UPDATE` — never `FOR UPDATE`, which conflicts with the KEY SHARE lock every FK insert on `ticket_events` and
  `notifications` takes), flushes, then calls `settle_job_status`. Capture `was` before an ORM UPDATE. Every move in
  or out is a `status_changed` event with exact `from_status` / `to_status`.
- **The catalogue** is on category nodes, inherited by everything beneath, plus a product's own
  (`merge_catalogue`: deepest row per case-folded name wins, inactive dropped); maintained by Admin/NH
  (`parts.catalogue`). A request names a catalogue row or an "Other" typed name (exactly one — a CHECK), and the
  label is frozen on the request as `part_name`. An open request for the same name on the same job is idempotent
  (`uq_spare_part_requests_open_name`).
- **States** `requested → approved | rejected`, `approved → issued | rejected` (a facility may cancel an APPROVED
  request, with a reason; `rejected_from` records which), `issued → returned`. Facility actions are allowed in ANY
  ticket status — an old part is returned after Complete — because they record physical facts. `PARTS_PENDING`
  refuses Complete; `PART_REQUEST_NOT_IN_PROGRESS` refuses a request outside `In Progress` / `Awaiting Part`;
  `PART_REQUEST_BAD_STATE` is a step out of order.
- **The desk is the TICKET's franchisee** (`spare_part_requests.franchisee_id`). Facility admin and operator share
  every part power; the admin also manages operators. **Nobody in the staff shell works the queue — the home
  franchisee included.** A franchisee with no active facility admin or operator (`franchisee_has_facility`; a
  franchisee admin does not count) answers a request with 409 `NO_FACILITY`, and the technician API says so with
  `partsEnabled` so the app hides *Need a spare part*. Company Admin/NH can create the HOME franchisee's facility
  users (`/spare-parts/home-facility-users`, `franchisees.manage` + a National-Head floor).
- **Notifications** use the `facility` audience (the fourth branch every notification reader learned) and the
  kinds `part_requested`, `part_decided`, `part_issued`; the technician is pushed `part.approved`, `part.rejected`,
  `part.issued` as `type: 'job'`. Codes use the `spare_part_request` sequence (`SPR`). `PartRequestOut` carries no
  customer PII; a return photo is a blob NAME under `attachment/{company_id}/`, validated by prefix.
- **`Awaiting Part` is non-terminal** (`core.tickets.TERMINAL_STATUSES` does not list it), so everything that asks
  "is it still open?" — the daily cap, the vendor credit reservation, the technician-delete guard, force-closure —
  includes it for free. Two lists that are written out by hand had to learn it: the jobs router's
  `SEGMENTS["inprogress"]` (or the job appears in no My jobs tab) and `RESCHEDULABLE_STATUSES`
  (`ASSIGNABLE_STATUSES + ("Awaiting Part",)`). A revisit uses the ordinary reschedule, which now also moves a
  started job and KEEPS its status (`core.reschedule.move_slot`); reassign stays at the four statuses it had.

## Moving a technician between franchisees (Task 17)

`POST /technicians/{id}/transfer` (`?dryRun=true` previews) and
`GET /technicians/{id}/transfers`, in `features/technicians/transfer_service.py`
with the decisions pure in `core/technician_transfer.py` and the audit in
`technician_transfers` (`e8a2c5b7d913`). A company **Admin or National Head**
changes WHO RUNS a technician from now on - their pool, their payer, their
pincodes - and nothing about what already happened.

- **The authority is `franchisees.manage` + a National-Head floor + the staff door,
  NOT `_load_managed`.** `_load_managed` answers "may this caller manage this
  technician?", which for a non-home technician is its franchisee admin's alone, so
  it would 403 every non-home technician for an Admin/NH. The technician is loaded
  with the ordinary `_load` (staff visibility): another company's, or one outside
  the caller's scope, is a 404, never a 403.
- ⚠ **All three guards are in the route's `dependencies=[...]`** (never stacked in an `Annotated`: FastAPI keeps only
  the LAST `Depends`). A pinned unit test (`test_technician_transfer.py`) reads the route table; the integration file
  calls the real route's guards. The router's older `CanView` / `CanEdit` aliases that once skipped
  `require_staff_principal` are FIXED — see hard rule 2.
- **History stays where it was earned.** The move writes `technician_profiles.franchisee_id`,
  the coverage rows, the region (when the new coverage is in one other region, D5)
  and a pending UPI change's reviewer (D6) - and issues NO `UPDATE tickets`, NO
  `UPDATE ledger_entries`, NO `UPDATE redemptions`. A reversal copies the penalty's
  own franchisee, so an old penalty is given back to the old pool; the monthly cap is
  the technician's across franchisees; two employee statements split at the month of
  the move. What makes that safe is the guard set: **no open job, no redeemable money
  and no unsettled redemption** (the type change's blockers, R5), because with none
  of them nothing but a reversal can write a row against the technician.
  `technician_type`, certifications, cap, base location, UPI, memberships and
  `manager_id` are untouched (D3/D4/D13).
- **Coverage is `current ∩ target's range`, or exactly the `pincodes` sent** (D1),
  never empty (422 `PINCODE_OUTSIDE_FRANCHISEE`), and the region follows it (D5).
  ⚠ With the F4/F6 invariant intact a technician's pincodes are all in their own
  franchisee's area, and areas are disjoint, so the no-`pincodes` path keeps NOTHING
  for any other target: the console's preview will usually say "nothing left" and
  open the picker. The kept/trimmed arithmetic matters only for drifted data (a code
  its franchisee no longer owns), which the integration test simulates.
- **Blockers are data on a preview and the first one is the error on an apply.**
  Order: same franchisee, target inactive, target has no admin
  (`FRANCHISEE_HAS_NO_ADMIN`, non-home only - R3), open jobs, balance / open
  redemption (`TECHNICIAN_HAS_BALANCE`), coverage (`PINCODE_OUTSIDE_FRANCHISEE`),
  then two regions (code-less 422). A NEGATIVE balance is a warning, not a blocker
  (D7). `core.ledger.open_redemption_exists` / `open_redemption_code` are the
  `uq_redemptions_one_open` predicate.
- **Locks, in this order:** routing (shared, `lock_routing`) then the profile row
  FOR UPDATE, re-read with `populate_existing` - the lock `redemptions.request`
  takes - so two moves of one person queue and the second judges the franchisee the
  first left (409 "already works for"). `request_upi_change` now takes the same row
  lock (`_own_profile(lock=True)`), or a request computed against the old franchisee
  could commit after the move and be addressed to admins who now get a 404. A dry run
  takes NO lock and rolls back.
- **Two bells, one push.** A non-home side is `audience='franchisee_admin'` +
  its id; the HOME side is company-wide carrying the home id (home's admins are
  company staff, F8). The push is `technician.moved` with `data={"type": "job"}` and
  **no ticket id** (the `penalty.reversed` shape) - installed builds refresh on any
  job push and an id would route a tap to a 404. It is sent after the commit and a
  failure never fails the move.
- **One race is left open on purpose:** `jobs.accept` does not lock the profile, so
  an accept landing between the open-job count and the commit leaves one job
  stamped with the OLD franchisee - the state a carve-out already leaves (F6).
- **Append-only.** No edit, no undo (a correction is another transfer), and the
  migration's downgrade refuses while any row exists. The dev acceptance file
  deletes its own rows at the end so the round trip stays possible.
- `core.franchise_routing.outside_message(owner_names=...)` is keyed by pincode
  CODE; `core.franchise.assert_pincodes_in_franchisee` passes it a
  `{franchisee_id: name}` dict, so the staff variant of its sentence never names an
  owner. The transfer builds the right mapping; the older caller is not changed.

## Handing an unassigned ticket to another franchisee (Task 18)

`GET /tickets/{id}/franchisee-options` and `POST /tickets/{id}/franchisee` (`{franchiseeId, reason}`), in
`features/tickets/service.py` (`franchisee_options`, `hand_to_franchisee`), the decisions pure in
`core/franchise_handover.py` and one column, `tickets.routing_override` (`f3b9d1a6c845`). Company staff
(`jobs.assign` + the Area-Manager floor + the staff door - exactly what `POST /{id}/assign` carries, no new
feature key) move a ticket nobody holds (`New`, `Slot Pending`, `Escalated` with no technician; anything with a
technician, `Awaiting Part` included, is 409 `TICKET_ASSIGNED`) to another franchisee, with a 3-255 character
reason.

- **Why a flag at all.** A technician's coverage must lie inside their own franchisee's range, so a pincode SkyFix
  owns can never be in another franchisee's technicians' coverage. A bare re-stamp would satisfy the franchisee
  test and fail the pincode test for everybody: stranded. `routing_override` means *"a person chose this ticket's
  franchisee; the pincode did not"* and waives **only the pincode half** of eligibility. Certification, `ACTIVE`,
  the daily cap, `accepting_work` and the franchisee test itself are never waived.
- **It is DERIVED, never typed.** The service sets `override_for(target, owner)` = `target != franchisee_for_pincode`;
  `HandToFranchiseeRequest` has no such field. Handing a ticket back to the pincode's owner clears it. It SURVIVES
  acceptance and release on purpose (a released handed ticket goes back to the franchisee it was handed to) - never
  "tidy" it to false because a technician took the job.
- **Five eligibility places, each waives the pincode half for an override ticket:** `jobs/service.pool_query`
  (`or_(Ticket.routing_override.is_(True), covers_pincode)`), `core/coverage.technicians_covering` (new REQUIRED
  keyword `routing_override`, forwarded by `announce_pool_job`), `tickets/service._load_assignable_technician`,
  `jobs/ws.py` (`pool_frame_matches(event_override=)` fed by `PoolChanged.routing_override`) - and **the guarded
  UPDATE in `jobs/service.accept` deliberately gains NOTHING**: it never tested the pincode (the `pool_query` read
  above it does), and a coverage clause "for symmetry" would re-strand every handed ticket at the last step.
  Anyone changing who may take a job changes all five; every `publish_pool_changed` caller passes the flag, the
  `accept`/`assign` ones as it was in the pool the ticket LEFT.
- **Counts for the picker** are `coverage.technicians_by_franchisee` (one grouped query; the pincode's own owner
  counts only technicians covering it, everyone else with the test waived - `franchise_handover.coverage_required`
  is the pure twin). Its docstring promises `online[F] == len(technicians_covering(F, override=F != owner))`.
- **Re-routing never undoes it (H5).** `restamp_ticket` returns None for an override ticket (unless
  `release_override=True`); the carve-out's `_plan` and `_apply` skip override tickets (the preview's "re-routed"
  count excludes them); **deactivating the target** hands its UNASSIGNED handed tickets back to their pincode owner
  (flag cleared, `franchisee_changed` by `system`, "<X> was deactivated · handed ticket returned to <owner>") and
  assigned ones keep theirs. `sweeps.sweep_unaccepted`'s grace now counts `franchisee_changed` beside
  `bonus_added`/`rescheduled`, or a ticket handed at 10:00 for an 11:00 slot would re-escalate on the next tick (a
  carve-out re-stamp gives its ticket the same breather - accepted).
- **One transaction, push after it.** Guarded UPDATE (`technician_id IS NULL AND status = :read AND franchisee_id
  = :read`; 0 rows -> 409 `ALREADY_ASSIGNED`), one `franchisee_changed` event (staff; status in `from/to` only when
  an `Escalated` ticket went back to the pool, `New` with a slot / `Slot Pending` without, and only while
  `still_offerable`), one `ticket_handed` bell (`audience='franchisee_admin'`, `franchisee_id` = the target, no
  pincode - the source franchisee and the manager hear nothing), two pool frames (the OLD franchisee's with its old
  flag so the card disappears, the NEW one's), then after the commit the push and `notified`. Shared routing lock,
  never exclusive. Money follows the TECHNICIAN (F12): nothing on the ticket's prices or `rules_snapshot` moves.
- **Errors, in the order tests pin:** terminal (409 `TICKET_NOT_ASSIGNABLE`) -> assigned/live (`TICKET_ASSIGNED`) ->
  same (`SAME_FRANCHISEE`) -> inactive target (`FRANCHISEE_INACTIVE`). An unknown or other-company franchisee or
  ticket is 404 (never 403).
- ⚠ **All three guards sit in each route's `dependencies=[...]`** (`HAND_OVER_GUARDS`), and a pinned unit test reads
  the route table. The older stacked `CanView` / `CanEdit`-style aliases are FIXED (hard rule 2), and
  `test_stacked_depends.py` now refuses any new one.
- The shortlist `GET /technicians?franchiseeId=&subcategoryId=&onDay=` (no `pincode`) is how the console assigns a
  handed ticket; it is still narrowed to technicians the manager can see (an Area Manager's states) - the existing
  rule, deliberately not widened. `seed/verify.py` excludes override tickets from
  `_open_unassigned_tickets_route_by_pincode` and adds `_handed_tickets_point_at_active_franchisees`. The downgrade
  refuses while any ticket is flagged or any `ticket_handed` bell exists.
- Not built: a bell to the SOURCE franchisee (its link would 404), the target declining, bulk hand-over, handing over
  an assigned ticket, a new feature key, re-basing the SLA deadline.

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

**A franchisee is a second wall inside the company.** A franchise principal asking for another franchisee's
technician, ledger row, redemption or part request gets **404**, exactly as for another company. The database
cannot say it (a `franchisee_id` link only proves the franchisee is THIS company's), so it is an application
invariant — `core.franchise_scope`, the franchise-twin routers and the service-level pin to
`principal.franchisee_id` — and `audit_tenancy` stays green either way, as it does for vendors.

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

#### Pincode coordinates (`pincodes.latitude` / `longitude`)

Loaded by `app.scripts.import_pincode_coordinates` from an external lat/lon file — not researched
by hand and not part of `RequirementDocs/Reliance Green Tech Pin Code.xlsx`. The script is
UPDATE-only (it never inserts a pincode the geography master does not already have), and
`import_geography` never writes these two columns, so a loaded point survives every future
geography sheet re-upload, exactly as `is_active` does.

As of 2026-10-16, RelianceDB carries a point for **19,496 of 19,496** pincodes — every row. Owner
ruling G2 stands regardless of coverage: **trust whatever the data says; a pincode with no point
contributes 0 km to the travel-distance calculation** (`core.coordinates.metres_between`) rather
than the request failing or a value being guessed. `RelianceProdDB` must be migrated to
`f9c2d8a3e17b` and loaded the same way before Task 10 (travel allowance) publishes against it —
see Environments below for running a one-off command against production.

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

**Every staff door that a franchisee may open for its OWN affairs carries a `/franchise` TWIN in
the same slice** (Task 05): `features/technicians/franchise_router.py` (roster, UPI changes),
`features/redemptions/franchise_router.py`, `features/ledger/franchise_router.py`,
`features/settings/franchise_router.py` (travel and speed) and, for its read-only picker master data and its
statements and facility users, `features/franchise_portal/` — all `prefix="/franchise"`. A twin is MEANT to
carry `require_franchise_principal` + a `franchise.*` feature key (never a staff floor — `require_min_rank`
refuses franchise roles) and to pin every query to `principal.franchisee_id` in the service itself; the staff
route beside it is MEANT to carry `require_staff_principal`, which is what keeps the twin's audience off the
console door (`require_min_rank` does not do that job — franchise roles are ranks 8–10, ABOVE the staff
floors). Same URLs as Task 09's screens, one guard per door.

⚠ **A stacked `Annotated[Principal, Depends(a), Depends(b)]` runs ONLY the last `Depends` — and every such alias is now
FIXED.** FastAPI reads one parameter with one dependency and keeps the last marker; the earlier guards were never called,
nothing logged it, and the alias read like two checks. 75 route registrations across 11 routers carried one (found by
introspecting every route with `get_dependant`); each is now ONE marker over
`app.core.deps.require_all(wall, feature[, floor])` — a function that takes each guard as its own single-marker
parameter, so FastAPI runs them in order and stops at the first 403. The order is fixed: **the wall first**
(`require_staff_principal` / `require_franchise_principal`), **then the feature key, then the rank floor**, so a caller of
the wrong family is told 403 about the door before anything else, and a guessed id still 404s in the service's scoped
loader afterwards. What each family now enforces, and what changed in behaviour:

| Router(s) | Aliases | Net guard set now enforced |
|---|---|---|
| `franchise_portal`, `ledger/franchise_router`, `redemptions/franchise_router`, `technicians/franchise_router`, `settings/franchise_router` | `CanSee`, `CanSeeStatements`, `CanTech`, `CanPay`, `FranchiseSettings` | `require_franchise_principal` + the route's `franchise.*` key (never a staff floor) |
| `technicians/router`, `ledger/router` (`CanSeeBalance`, `CanView`), `settings/router` (`EditTravel`) | `CanView`/`CanCreate`/`CanInvite`/`CanEdit`, … | `require_staff_principal` + the feature (`require_any_feature` for `CanSeeBalance`) |
| `ledger/router` | `CanSeeStatements` | staff + `earnings.view` + National-Head floor — the feature check was the part that never ran |
| `redemptions/router` | `CanPay` | staff + `redemptions.pay` + National-Head floor (the floor moved from `dependencies=PayerRoute` into the alias, so it runs once; the staff wall was the part that never ran) |
| `settings/router` | `EditTravel` | staff + `settings.edit` + **National-Head floor — `PUT /settings/travel` had no floor at all**, despite its docstring |
| `tickets/router` | `CanReversePenalty` | staff + `penalties.reverse` + Area-Manager floor (moved from the route's `dependencies` into the alias) |
| `franchisees/router` | `CanView`, `CanManage`, `CanEditSpeed` | staff + `franchisees.view` (AM floor) / `franchisees.manage` (NH floor) / `settings.edit` (NH floor) — the feature key was never consulted, so switching `franchisees.manage` off changed nothing |

The tightening cost no default access: every key now enforced is already granted to the roles that use the route
(`franchisees.view` admin/NH/RH/AM; `franchisees.manage`, `settings.edit`, `earnings.view`, `redemptions.pay`
admin/NH; `penalties.reverse` the four staff roles; `technicians.*` admin/NH/RH/AM; `franchise.*` franchisee admin).
What does change is that a company that had switched one of these off through Feature Access now actually loses the
door, and `PUT /settings/travel` is closed to a Regional Head / Area Manager who holds `settings.edit`.

**Pinned at zero.** `tests/unit/test_stacked_depends.py` walks every route and every dependency it pulls in and fails on
ANY `Annotated` carrying two `Depends` (with a self-test that the detector still finds a synthetic stack, so zero cannot
mean "broken detector"); `tests/unit/test_guard_pairs.py` drives representative routes of each router with a crafted
principal and proves the feature, the floor and the wall each refuse on their own. **New code** puts every guard in
`require_all(...)` or in the route's `dependencies=[…]` (as `spare_parts`, `HAND_OVER_GUARDS` and the transfer route do);
never two `Depends` in one `Annotated`.

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

Four kinds of principal now sign in: staff, technicians, **vendors** and **franchise users**. A vendor
is an outside party, so two rules govern it and neither is expressible with the tools the other roles use (the
franchise family has its own wall — hard rules 1 and 2).

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
| `franchisee_admin` | `franchisee_id = mine` — by OWNERSHIP, read-only (F13) |
| `facility_admin` / `facility_operator` | the tickets of their franchisee that have a part request |

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

`on_time_pct` was the last of the four to get a writer (`c5e8a1d3f7b2`, which also backfills it).
`feedback_service.refresh_technician_stats` recomputes it on every closure beside the count and the
rating: **the share of Closed and Force-Closed jobs where the live proof photo was taken no later
than `NO_SHOW_GRACE_MINUTES` after `slot_end`**. That's the no-show sweep's own grace, so an arrival
that sweep would not call absent is never called late.

- **The photo's time, not the upload's.** A technician can be offline between the two, so the
  phone's `captured_at` is used, capped at the server's `started` time. A clock set back is the
  accepted risk; the ticket shows both times side by side.
- **A job is left out, never counted late,** when it has no slot, or its latest `assigned`
  post-dates `slot_end` (the sweep's own test, for the technician sent to a window already shut),
  or no `started` event follows the latest `assigned` / `slot_confirmed` / `rescheduled` (a
  re-assigned job's previous holder, a force-closure nobody started, a slot booked after work
  began).
- **Rounding never overstates:** 199 of 200 shows 99%, not 100%. Null is still "nothing to measure",
  never 0.

The docstring argues each clause. The migration restates the same rule in SQL, so change both
together.

When a table is genuinely needed before its writer lands, write the writer in the same change.
`ticket_events` declares only the four `kind` values the code writes TODAY; assignment and release
join the CHECK in the migration that adds the accept flow, not before.

**A migration that rewrites a CHECK vocabulary spells the BEFORE list out and asserts it against
`pg_get_constraintdef`** (`d6c3a9f1e874`'s `_assert_check_is`): `ticket_events.kind`, `notifications.kind` /
`audience`, `tickets.status` and `ledger_entries.kind` were each rewritten by several tasks working in parallel, and
a list copied from memory silently drops the values the others added. Compare the live definition first.

Three things the autogenerated diff gets wrong every time:

- It wants to DROP the hand-written functional and partial indexes — `uq_companies_gst_lower`,
  `uq_users_email_lower`, `uq_memberships_user_company`, the `lower(name)` ones on the product
  master and vendors, `uq_tickets_slot_token`, the live-invite index, and the franchise-era ones —
  `uq_franchisees_company_name_lower`, `uq_spare_parts_node_name`, `uq_spare_parts_model_name`,
  `uq_spare_part_requests_open_name` (and the partial uniques on `ledger_entries` and the speed matrix). SQLAlchemy cannot express
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

**But unchecked is not a free pass for a serial the master gives to ANOTHER product.** QA raised a
washing machine's serial against a switch board with no serials, under the form's own mismatch
notice, and it went through. So a miss on the chosen model now asks first whether one of the
**same vendor's live products** carries the number (`tickets.serial_owners`), and if so refuses
with 400 `SERIAL_ON_OTHER_PRODUCT`, naming it — whether or not the chosen model has serials. The
older refusal now carries a code too, `SERIAL_UNKNOWN`; both are `_serial_refusal`'s
`SerialRefusal(code, message)`, and the importer puts the same pair on a rejected row.

- **Same vendor only — the oracle guard.** Pinned in the query: a serial on a competitor's product
  behaves exactly as an unknown serial does, so intake can never confirm that somebody else's
  number exists. Staff correcting a ticket are measured against the TICKET's vendor, not theirs.
- **Live only** — approved, active, not deleted, under a live category: the set
  `masters.lookup_serial` offers. So the form can always show this refusal before submit, and its
  "Use …" offer always lands on something intake accepts. A paused or retired product's serials
  block nothing.
- **A serial on the chosen model is fine whatever else carries it** — one serial on two products
  is legal, and a hit on the chosen one returns before the other-product probe runs.

Three things about it are load-bearing:

- **A serial is never CONSUMED.** Raising a ticket spends nothing here and marks nothing used.
  `tickets.serial_number` is deliberately not unique — a service call on a unit installed months
  ago repeats its serial — so a row has to keep matching for the life of the unit. Treating these
  as stock to draw down would break the second visit to every customer.
- **The order of the queries is the point.** An index probe for the typed serial answers the
  common case; only a MISS pays for the other-product probe and then the `EXISTS` that tells "not
  loaded, allow" from "loaded, refuse". Counting the model's serials up front is the obvious implementation and the
  wrong one — it reads thousands of rows to answer what the unique index already answers.
- **`correct_serial` runs the same guard**, and without it the whole thing is bypassable: raise the
  ticket quoting a serial the model covers, then `PATCH /tickets/{id}/serial` to anything. That
  endpoint is open to the vendor by design, which is exactly who the intake check is for.
- **`GET /tickets/{id}/serial-check?serial=` asks the same question without writing**, so the
  console's correction dialog can say a number will be refused while it is typed rather than in a
  toast after Save. Both go through `_serial_refusal`, which returns the sentence
  `_assert_serial_known` raises — never restate the rule in a second place. It mattered because the
  dialog's one-click suggestion is the number the technician read, which is exactly the number
  nobody loaded. Exact match on the ticket's own model only, so it is not the prefix oracle
  `lookup_serial` has to guard.
- **When the TECHNICIAN mistyped, `PATCH /tickets/{id}/observed-serial` corrects the reading.**
  `correct_serial` fixes only the order, so a right order and a wrong reading had no way out: the
  right number was already the order's (nothing to save) and the typo was refused by the list. This
  one edits evidence, so it is Area Manager and above with `jobs.assign` — never the vendor — the
  reason is required, the old value goes into a `serial_corrected` event (one kind for both
  corrections; the note says which, so no migration), and the serial photo is what the manager
  reads the number from. Deliberately NOT checked against the serial list: a reading says what is
  on the unit, and an unknown unit is what a mismatch exists to surface.

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
starter file, and it carries no data — one header row and nothing under it, identical for every
caller. No example serials: one left in the sheet would import as a real serial.

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
                         franchise-era: franchise, franchise_scope, franchise_logins,
                         franchise_routing, franchise_handover, carve_out, pincode_ranges,
                         audience, franchise_money, penalty_reversal, employment, statements,
                         accept_snapshot, travel, travel_rules, base_location, speed,
                         speed_rules, speed_settle, spare_parts, technician_transfer
  db/                    base_class (naming convention), mixins, repository (territory_scope)
  emails/                templates/*.html and the renderer — the ONE place an email
                         BODY lives. Content only; the egress is integrations/.
                         Filled with string.Template ($name), NOT str.format, because
                         an email is mostly CSS braces. Every value is html-escaped.
  features/<slice>/      router.py · schemas.py · service.py — nothing else
                         (franchise-era slices: franchisees, franchise_portal, spare_parts;
                         a slice's `/franchise` twin is a second router file in the same slice)
                         NB `vendor_users` is its OWN slice, not part of `users`:
                         `users.*` gates the COMPANY's staff, and a vendor
                         holding it could read every manager in the tenant.
  integrations/          whatsapp.py, acs_email.py, otp_channel.py, blob.py — OUTBOUND,
                         and never raise on failure.
                         google_identity.py is the exception and says so: it is
                         INBOUND verification, where a bad token has exactly one
                         right outcome and there is no record to preserve.
  models/                one module per area; every model reachable from __init__
  scripts/               bootstrap, audit_tenancy, create_database, copy_geography, cleanup_db,
                         seed_synthetic, seed_demo, seed_play_review; seed/ is their shared
                         package (tenant, lifecycle, backdate, verify, guards)
tests/unit/              pure-function pytest only — no database (see "Unit tests")
tests/integration/       service-level acceptance walks against the DEV database — run by hand,
                         never by CI (see "Unit tests")
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
$env:CONFIRM_PROD='yes-i-mean-it'; $env:POSTGRES_DB='RelianceProdDB'
python -m alembic upgrade <revision>      # the release's revision, never "head"
Remove-Item Env:CONFIRM_PROD, Env:POSTGRES_DB
```

`alembic/env.py` refuses `RelianceProdDB` without `CONFIRM_PROD`, and **the owner migrates production to an
EXPLICIT revision before each publish** — `main` may carry a later migration than the release needs, and naming
the revision makes the sitting do exactly what the release gate allowed. Several of the franchisee migrations are
migrate-then-publish-in-the-same-sitting (a NOT NULL column the old API never writes).

⚠ **Whether an App Service migrates by itself on restart is NOT settled in the repo.**
`.github/DEPLOYMENT.md` says both startup commands are `python -m alembic upgrade head && gunicorn …` (so a
publish runs `upgrade head` against whatever that service points at, and a failing migration takes the backend
down); the `publish-api` skill and `publish.py` show gunicorn only. Confirm it in the Azure Portal before a
release that carries a migration, and record the answer in `DEPLOYMENT.md`.

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

## Database cleanup — deleting companies and everything under them

> Decisions locked in a grilling session on 2026-09-15; built as `app/scripts/cleanup_db.py`
> the same day, and exercised then with `--rollback` on `RelianceDB` (keep list empty, and keeping
> one company) and `--dry-run` on `RelianceProdDB` — no guard fired, nothing committed on either.
> Dev held no tickets at the time, so the ticket, proof and money tables have only ever been
> planned against, never deleted from: that is what the rehearsal below is for.

`python -m app.scripts.cleanup_db --keep <company-id> …` deletes **every company not on the keep
list**, with all of its tenant rows, and every user left with no reason to exist. It is mainly for
wiping `RelianceDB` between rounds of testing, and it runs against `RelianceProdDB` once, to clear
the internal and third-party test companies without touching the client.

Why a keep list and not a delete list, and why that is the dangerous half: on dev "delete
everything but what I name" is exactly the job. On prod it means a real company that signed up
since the list was written is deleted along with the test ones — which is what the plan printout,
the two prompts and the name guard below exist to catch.

Why it deletes **companies** and not just "user data": `users` is global and a person reaches a
company only through `memberships`, so there is no user-shaped slice of the database that is not
also a company-shaped one. A deleted company takes its rules, catalogue, serials, vendors, brands,
tickets, money and people with it; the superadmin re-creates it, and it gets fresh free credits and
default rules like any new company.

### What survives

| Kept | Why |
|---|---|
| Every company on `--keep`, and **every row it owns — untouched**, soft-deleted rows included | The client's own setup and history; nothing about them is test data |
| Every live company in `PROTECTED_COMPANY_SLUGS` — today **`RGT Play Review`** — **whatever `--keep` says**, even an empty list and even a driver that calls `run()` directly | Google Play's reviewers sign in to it (see "Google Play review sign-in"); deleting it gets the next submission rejected. Matched by slug, because its id differs per database |
| The superadmin (`users.role = 'superadmin'`) | The only way back in after a full wipe |
| Any user with a membership in a kept company | Otherwise the kept company survives with nobody able to sign in to it, and its history names authors who no longer exist — worse than deleting it, because nothing on screen says so |
| Franchise logins (`franchisee_admin`, `facility_*`) | Nothing special: they are `users` with a `memberships` row, so they follow their company's memberships like any user — kept with a kept company, deleted with a deleted one. `delete_order` derives `memberships`/`tickets`/… → `franchisees` from the live FKs |
| `regions`, `states`, `districts`, `pincodes`, `pincode_districts` | Global master; ids are shared with the other database via `copy_geography` |
| `platform_settings`, `features`, `role_feature_defaults`, `roles`, `alembic_version` | Platform configuration, not tenant data |

A user with memberships in both a kept and a deleted company keeps the account and loses only the
deleted membership. A user left with **no** membership is deleted, whatever their role — a vendor
login with no vendor behind it can authenticate and do nothing, and it holds its email hostage
(`users.email` is unique platform-wide, so re-creating that vendor would 409). There is no
hand-maintained user keep list. `otp_codes` and `refresh_tokens` go with their user; unattached
OTP rows go only if expired.

⚠ **It hard-deletes users**, which breaks an assumption `ActorMixin` states outright: *"actors are
never hard-deleted"*. `created_by` / `updated_by` are plain UUIDs with no FK, so a deleted user's
id left in a kept company's rows fails nothing. Rule 2 above — keep anyone with a kept membership —
is what stops that happening to the client; it does not cover a person who once acted in a kept
company and has since lost that membership.

The franchise-era tables are all per-company and classified in `COMPANY_TABLES` (`franchisees`,
`franchisee_pincodes`, `franchisee_travel_rules`, `franchisee_speed_rules`, `spare_parts`, `spare_part_requests`,
`technician_transfers`); money is already summed (`travel` and `speed_*` are `ledger_entries` rows, parts carry no
money). **`ALLOWED_DANGLING_FKS` gained nothing, deliberately:** `technician_profiles.base_set_by_user_id → users`
is a real FK (`ON DELETE SET NULL`), so a kept technician whose base was set by a user being deleted would stop the
run — which cannot happen today, because anyone who acted in a kept company keeps an account through their
membership, and if it ever does the refusal is the right outcome.

### Locked decisions

| # | Decision | Rejected alternative | Honest cost | Enforced by |
|---|---|---|---|---|
| 1 | **Keep list** of company **ids**; everything else is deleted. The script prints each id beside its name | A delete list; naming by slug or GSTIN (prod holds two Twincore rows with the same GSTIN and near-identical slugs) | A real company created after the list was written is deleted unless somebody reads the plan | The printed plan + decisions 3 and 4 — the list itself is convention |
| 2 | Users survive **only** as superadmin or through a kept company's membership | Deleting everyone but named users (would lock the client out); keeping bare logins by hand | Someone who once worked in a kept company but no longer has a membership there is deleted, and their id dangles in `created_by` | Script |
| 3 | **Backup first, made by the script:** `pg_dump -Fc` of that one database to `api/backups/<db>-<timestamp>.dump`. No dump file, or an empty one → no delete | Relying on Azure point-in-time restore (restores the whole SERVER, which holds both databases, into a new server — hours); taking the operator's word | Production customer names, phones and addresses sit on the operator's machine indefinitely; the script never deletes a dump. `pg_dump` must be findable (it is not on PATH on every machine — e.g. `C:\Program Files\PostgreSQL\18\bin`) | Script. `api/backups/` is git-ignored, and the script refuses to write there if `git check-ignore` says it is not |
| 4 | **Two prompts before anything is deleted:** type the database name exactly, then type `YES`. Shown first: database and host, each company to be deleted (name, id, ticket / technician / user counts, last ticket date), each company kept | `y/N`; `YES` alone (the same word on dev and prod, so twenty dev runs train the hand that types it on prod) | A few more keystrokes on every dev run | Script |
| 5 | **Database rows only.** Blob storage is not touched; the deleted company ids are printed and written beside the dump | Deleting `{prefix}/{company_id}/` from both containers | Deleted companies' proof photos and payment screenshots stay in the private container, pointed at by nothing | Script (by omission) |
| 6 | An **empty keep list is refused on `RelianceProdDB`** (case-insensitive name match) and allowed on any other database | Allowing an empty keep list only on `RelianceDB` and refusing it everywhere else | A production copy under any other name — a restore, a rehearsal, a future staging database — can be emptied with only decision 4 in the way | Script |
| 7 | **Every table must be classified** (keep / per-company / per-user) in the script, or it refuses to run. `--check` runs only this, with no database | A step in `pr-check.yml` that fails the PR adding the table | ⚠ **CONVENTION ONLY at the time it matters.** An unclassified table is found by whoever next runs a cleanup — possibly months later, possibly in a hurry — not by whoever added it. Run `python -m app.scripts.cleanup_db --check` after adding a table | Script, at run time only |
| 8 | **Proven before prod on a restored prod dump**, then checked by hand, then run for real (procedure below) | Trusting a dev run; relying on the in-transaction checks alone | About an hour, and a second copy of production data on the server while it exists | Checks 1–5 by the script; the rehearsal itself and check 7 are convention |

### Built-in checks — the script rolls back if any fails

The whole run is **one REPEATABLE READ transaction**. The script measures, deletes, measures
again, and rolls everything back if a number moved that should not have:

1. **Kept rows unchanged, deleted rows gone** — for EVERY table, the rows expected to survive are
   counted beforehand, and the table must hold exactly that many afterwards. One measurement
   covers the kept companies, the deleted ones, users, tokens and OTP codes alike.
2. **Money unchanged** — the kept companies' `SUM` over `ledger_entries.amount_paise`,
   `credit_entries.credits`, `credit_recharges.amount_paise` and `redemptions.amount_paise`.
3. **No orphan users** — every remaining non-superadmin holds a membership.
4. **A superadmin remains.**
5. **Platform data unchanged** — falls out of (1): a table this script never deletes from must
   hold the same count afterwards.

And three refusals before anything is deleted, which counts alone could not provide:

- **An unknown `--keep` id stops the run.** A typo in the client's id would otherwise leave the
  keep list naming nobody — and delete the client.
- **A surviving row that references a deleted row stops the run** (every live FK is tested).
  A `SET NULL` or `CASCADE` would change the kept row without changing any count. The one
  exemption is `users.last_active_company_id`, the company switcher's memory.
- **The plan is re-read inside the delete transaction.** If a company or user appeared or vanished
  since it was printed, nothing is deleted — a company registered between the prompt and the
  delete is never removed unseen.

Kept rows whose un-keyed author columns (`created_by`, `decided_by`, `*_by_user_id`, …) name a
deleted user are **listed, not refused** — that is decision 2's accepted cost.

`--rollback` runs every delete and every check above, then rolls back: no prompts, no dump,
nothing committed. It holds row locks for the length of the run, so prefer it on dev or a
rehearsal copy over the live production database.

Then, outside the script:

6. `python -m app.scripts.audit_tenancy` exits 0.
7. **Somebody signs in.** Point a local API at the database and sign in as the superadmin and as
   the kept company's admin; open one of its tickets, its vendor list and Credits.

### Running it against production — the procedure

```powershell
# 1. see what it would do — no dump, no prompts, no deletes
$env:POSTGRES_DB='RelianceProdDB'; python -m app.scripts.cleanup_db --keep <client-company-id> --dry-run

# 2. rehearse on a copy. No production dump exists until a real run makes one, so take it by hand
#    (PGHOST/PGUSER/PGPASSWORD/PGSSLMODE from .env.production — in the environment, not the command)
pg_dump --format=custom --dbname=RelianceProdDB --file=api/backups/RelianceProdDB-rehearsal-source.dump
python -m app.scripts.create_database --name RelianceProdDB_rehearsal
pg_restore --no-owner --dbname=RelianceProdDB_rehearsal api/backups/RelianceProdDB-rehearsal-source.dump
$env:POSTGRES_DB='RelianceProdDB_rehearsal'; python -m app.scripts.cleanup_db --keep <client-company-id> --rollback
$env:POSTGRES_DB='RelianceProdDB_rehearsal'; python -m app.scripts.cleanup_db --keep <client-company-id>
$env:POSTGRES_DB='RelianceProdDB_rehearsal'; python -m app.scripts.audit_tenancy
#    then check 7 by hand against the rehearsal database

# 3. only then, for real — with the SAME keep list
$env:POSTGRES_DB='RelianceProdDB'; python -m app.scripts.cleanup_db --keep <client-company-id>

# 4. drop the rehearsal database; it is a full copy of production
```

⚠ **The keep list must be written from what production holds on the day, not from this page.** As
of 2026-09-15 production held four companies — DECCANSOFT SOFTWARE SERVICES (internal testing),
RELIANCEGREENTECH PRIVATE LIMITED (the client — **keep**), and TWINCORE TECHNOLOGIES PRIVATE LIMITED
twice (one active, one inactive, same GSTIN). The app had just been published; anything registered
since is exactly the case decision 1 warns about.

## Seeds, and the checks that make them mean something

`seed_synthetic` (a load-test company), `seed_demo` (the client walkthrough) and `seed_play_review` (Google Play's
reviewer) all build through the real services in the shared `app/scripts/seed/` package — `tenant.build`
stands the company up, `lifecycle.drive` walks tickets through accept, proof, complete, cancel, force-close and
the customer's answer, `backdate` moves the settled ones into the past, and `verify` proves the numbers add up.
Nothing INSERTs a row a service would have written; a company assembled by hand is missing exactly the rows
(`company_rules`, the home franchisee, the travel-rule pair, the credit entry) whose absence only shows up later
as an empty screen.

- **They dress the franchisee-era shape on purpose** (Task 16): the technicians are placed by a repeating pattern
  across the HOME franchisee and two carved out of its pincodes — an external one with a facility operator and an
  internal one with none, so `NO_FACILITY` is a path the run walks — the second technician of every five per
  franchisee is an employee, one in five has no base (so `no_base_location` is produced), both franchisees get
  travel rules and a freelancer speed rule, the first category has a parts list, a share of jobs wait in
  `Awaiting Part`, a third of the jobs that close raise a part first (approved and issued by the franchisee's
  operator, half returned afterwards), one unassigned home ticket is handed to the external franchisee and,
  after backdating, one technician with history is transferred. **`--plan` prints the shape; the run ends with
  `verify.rows_read`, the number of rows each franchisee-era check actually read.** A check that reads no rows
  passes on anything, and a seed that quietly stopped producing employees or parts would turn half of
  `verify.run` into a formality — an empty line in that table is the warning.
- **The seeded travel rule is not the product default.** Every seeded pincode is inside one city, a few
  kilometres apart, so the 20 / 30 km free distance would pay ₹0 on every job and the travel checks would read
  nothing; the seed uses 2 / 4 km (`tenant.TRAVEL_FREE_KM`) and says so where it is set.
- **A vendor's credit line stops a seed.** Every ticket reserves its price until it closes, and a vendor is
  created with ₹5,000 of room, so a seed written before the line existed raised three tickets and refused the
  rest — and `drive` counts a refusal instead of failing, so the run came back "green" and nearly empty. The seeds
  now create their vendor at the credit ceiling, `seed_play_review` raises its vendor's line on every run, and the
  synthetic and demo scripts FAIL when a quarter of the planned tickets were refused.
- **`verify.py` compares two paths over real rows.** Beyond the original five checks it now covers: the home and
  its pincode rows (F4), open unassigned tickets against `franchisees_for_pincodes`, handed-over tickets and their
  flags, technicians on live franchisees, employees never paid per job, the ledger's franchisee and type against
  the accept snapshot (a reversal against its penalty), earnings against the ledger with given-back penalties left
  out, one `travel` row per closed job at the frozen amount and never above its cap, speed rows only on closed
  tickets with a frozen rule and never on a force-close, each franchisee's pool against the F12 formula, an
  employee's statement against a plain SUM, spare-part requests against the ticket's status, and a transferred
  technician's old money against the franchisee they had when it was written. The last two families carry the
  caveat in their docstrings: a carve-out also moves technicians without a transfer row, so a hit is a prompt to look.
- **Run against a database that holds acceptance-test data (`tests/integration`, the Task 05 cast), `verify` reports
  that data's residue** — payouts written while a technician was briefly an employee, tickets accepted before
  `accept_snapshot` existed — and that is not a regression. Run it per company.
- **`seed_synthetic` writes a whole company into a SHARED database.** `cleanup_db --keep <the others>` removes it; a
  run that fails part-way leaves a half-built company behind, so name each attempt with its own `--tag`.
  `LIKE 'Seed Appliances%'` lookups in the acceptance tests and `seed_franchisee` take the first match, so do not
  add a second company with that prefix to a database those still use.
- **Sends:** a seed creates logins (emailed a temporary password) and technicians (WhatsApped an app link, on the
  first few to the team's real numbers). On dev set `WHATSAPP_ALLOWLIST` / `ACS_EMAIL_ALLOWLIST`, or run with
  `WHATSAPP_TOKEN=` and `ACS_CONNECTION_STRING=` empty and `PUSH_ENABLED=false` in the environment (an environment
  variable outranks `.env`), and the temporary passwords come back in the output instead.

## Unit tests

`pytest` (`pytest.ini`, `tests/unit/`) tests **pure functions only — parsers, calculators, state
machines.** Owner ruling X1: API unit tests never touch a database; what a request actually does
is proven by each task's acceptance criteria and by `app/scripts/seed/verify.py`, not by pytest.

`tests/unit/conftest.py` carries an `autouse=True` guard fixture that monkeypatches
`sqlalchemy.ext.asyncio.create_async_engine` and `psycopg.connect` / `psycopg.AsyncConnection.connect`
to raise — `tests/unit/test_no_db_guard.py` is what proves the wall is actually there, not merely
documented. The same file sets placeholder `POSTGRES_*` / `JWT_SECRET_KEY` env vars in its **module
body**, before `app` is ever imported: `app/core/config.py` builds `Settings()` at import time and
fails without them, and collection fails before any fixture runs if they are set inside one instead.

**Rule for every later task:** a module tested here must be importable with no database. If a pure
function lives beside DB code, the test imports only the pure symbol; if importing the module pulls
in an engine, move the pure function to its own `app/core/` module first.

`tests/integration/` is the OTHER kind and is not collected (`pytest.ini` points at `tests/unit` alone, so
neither `python -m pytest` nor CI runs it): service-level acceptance walks, one file per franchisee task, that
build hand-made `Principal`s and drive the real services against the DEV database, with no HTTP. They are run by
hand — `.venv/Scripts/python.exe -m pytest tests/integration/test_taskNN_acceptance.py -v` — leave real rows
behind, and share the cast the first of them seeds (`app/scripts/seed_task05.py`), so they depend on the state
earlier runs left: an interrupted run can fail the next one for reasons that are not a regression (open jobs left
on the cast, a type change refused over them). Never point them at production.

`pytest==8.*` lives only in `requirements-dev.txt`, never in `requirements.txt` — that file is what
Oryx installs on Azure (`scripts/publish.py`), and test tooling must not ship.

## Commands

```bash
python run.py                              # uvicorn on :8000 — DEVELOPMENT database
python -m alembic upgrade head             # DEVELOPMENT unless POSTGRES_DB is overridden
python -m app.scripts.seed_synthetic --plan  # a synthetic company: franchisees, employees, parts… (dev only)
python -m app.scripts.seed_demo --plan       # the client walkthrough company
python -m app.scripts.seed_play_review --plan  # the Play reviewer's company — re-run before each submission
python -m app.scripts.bootstrap            # the platform superadmin
python -m app.scripts.audit_tenancy        # after any schema change
python -m app.scripts.create_database --name <db>      # a new database on the same server
python -m app.scripts.copy_geography --to <db>         # the geography master, ids preserved
python -m app.scripts.cleanup_db --check               # after adding a table — no database
python -m app.scripts.cleanup_db --keep <id> --dry-run # see "Database cleanup" before anything else
pip install -r requirements-dev.txt && python -m pytest  # unit tests — pure, no database (see above)
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

## The bulk ticket importer — a spreadsheet in, tickets out

`features/tickets/import_service.py`, `POST /tickets/import` (a vendor's own) and
`POST /tickets/import/on-behalf` (staff, naming a vendor). It is the **Excel intake channel**
that `core/intake.py` has described since before anything read it, and it keeps the contract
`geo.import_geography` and `masters.import_serials` already set: two passes over one file, a
dry run that writes nothing and returns exactly what the commit would do, per-row rejects that
never block the good rows, and nothing parsed in the client.

**The Category column names a whole chain**, root first, the last one marked:

    Electronics, Television, Android TV(islastsubcategory)

Anything missing is created. The marker is strictly a checksum — the last segment is the leaf by
definition — and it is required anyway, because a truncated paste otherwise builds a branch in
the wrong shape that a vendor cannot undo (there is no vendor DELETE for a node).

⚠ **A comma is not a safe delimiter on its own.** `product_nodes.name` is free text, so
`Cooking, Baking & Grills` is a legal name. **If a cell contains `>`, `>` is the delimiter;
otherwise the comma is** — per cell, never mixed. A name containing `>` cannot be expressed,
which is the trade; the console renders paths with `›` (U+203A), so nothing on screen collides.

**The one conflict no single row can see** is two rows disagreeing about where products go —
`A, B(islastsubcategory)` in one and `A, B, C(islastsubcategory)` in another. `B` cannot be both
a leaf and a parent. **Both rows are rejected and the chain is dropped from the plan**: there is
no way to know which was meant, and building it either way is a branch somebody did not ask for.
Detected in memory, before anything is written.

⚠ A ONE-segment chain is rejected in `parse_chain`, not left to the database. It asks for a root
that holds products, which `leaf_below_root` forbids — but more importantly an unrejected one is
a leaf path of length 1, so the reconciliation above would read every ordinary
`Electronics, Television` row in the file as disagreeing with it, and one impossible cell would
reject the whole sheet with a sentence about the wrong problem.

**A product the file names but the catalogue lacks is SUBMITTED, not ticketed.** Pending, both
prices NULL, and the rows naming it rejected with "waiting to be priced" — which holds whoever
ran the import, because `approved_is_priced` means an approved row carries both figures and staff
cannot price from a sheet with no price columns either. Somebody approves it on `/approvals`, the
same file goes in again, and those rows import.

**Which is why `tickets.external_ref` exists.** That second upload re-presents every row that
already worked, and nothing else on the table could catch it — `serial_number` is deliberately
not unique. So a row carries the vendor's own job number, unique per vendor through the partial
index `uq_tickets_vendor_external_ref`, and a repeat is **skipped and reported, never rejected
and never charged**. A row with no reference gets no such protection, and the template says so.

**What the sheet deliberately does not carry:** no `Vendor` column (the tenancy boundary), no
`Latitude`/`Longitude` (null is the true statement "this address was typed", and it is what keeps
the pincode proof rule for this channel), and no slot columns — a slot must be one of the windows
`offered_slots` produces with a 90-minute lead, so a sheet authored at 09:00 and uploaded at 14:00
would have half its slots refused for a reason nobody could fix by editing it. Every imported
ticket lands `Slot Pending` and the customer picks.

**Shape rules are not restated.** Each row builds a real `TicketCreateRequest` with placeholder
ids and catches `ValidationError`, so the description rule, the service type, the service level,
the phone and the pincode shape cannot drift from the form. The two that need a database row reuse
the single-ticket path's own sentences through `service.serial_refusal_text` (plus
`serial_elsewhere_text`, fed by the same `serial_owners` query) and
`service.pincode_refusal_text`. ⚠ The **past-date rule is the exception and has to be**: it is not
in the schema — `create_ticket` applies it separately, because "has this day gone" needs a clock.
`today_ist` is computed once for the whole file, so an upload straddling midnight judges every row
against one instant.

**The per-row work is deduplicated, not repeated.** Products resolved once per distinct
(chain, brand, model); pincodes in one `IN`; rules memoised per node; every node loaded in one
query; and **one** `sequences.allocate(…, count)` for every code in the file — the counter was
redesigned for exactly this, and `service.next_code`'s own docstring says the old `COUNT(*)`
scheme raced and that "bulk upload would have made that the normal case".

**The commit is ONE transaction** — categories, pending products and tickets together. A row
rejected for "waiting to be priced" is a normal outcome and rolls nothing back; only a hard
failure does, and then nothing is written. Chain creation is deliberately not committed
separately: a file that created twelve categories and then failed to charge would leave a
catalogue nobody asked for and no tickets to explain it.

**Credits are whole-or-nothing** (`core.credits.charge_tickets`, the bulk sibling of
`charge_ticket`): one advisory lock, one balance read, N append-only entries. A partial charge
would mean the importer choosing which of somebody's rows to drop for a reason unrelated to the
rows, and `uq_credit_entries_company_ticket` makes a part-charged file a part-written one. The
dry run already showed `required` against `available`, so a refusal here only fires on a race.
⚠ **Take the lock LATE** — it is `pg_advisory_xact_lock`, held to the end of the transaction, and
every single-ticket `create_ticket` takes the same key. Parse, resolve and build all 500 rows
first, so a vendor raising one ticket by hand waits milliseconds rather than the whole import.

**Slot-request WhatsApps are swept, not sent inline** — 500 Meta round trips do not fit in one
request. Imported tickets are left `slot_request_status='pending'` and
`sweeps.sweep_pending_slot_requests` drains them. That also closes a gap that predates the
importer: `pending` is written in the constructor and only ever cleared by the send, so a process
that died between the commit and the send left a customer nobody would ever ask, invisible to
`sweep_silent_slots` (which keys on the `slot_requested` event that was never written). **`pending`
only, never `failed`** — a failed row carries Meta's own words and is somebody's action item;
retrying it would overwrite the reason.

**Two storms are damped.** Pool frames are deduped to one per distinct `(pincode, node_path_ids)`;
per-ticket console frames and `push_pool_job` are capped at 25 and skipped above it, because that
function runs `technicians_covering` per ticket. ⚠ Above the cap a technician with the app CLOSED
is not pushed — the pool frame reaches open apps and `sweep_unaccepted` still escalates, but a
batched push ("12 new jobs near 500001") is the real fix and is its own piece of work.

**Staff need a key of their own: `jobs.import`.** Not `jobs.create` — hard rule 2 — because that
one was deliberately revoked from all four staff roles by `d5f61c07ab29` and the console reads it
to decide whether to draw a Raise-a-ticket screen. Seeded to admin and national_head and paired
with `require_min_rank(NATIONAL_HEAD)`: a bulk file carries pincodes from anywhere, and hard rule
3 says an Area Manager acts only inside their own states, so admitting one would mean a per-row
territory refusal rather than a rule that either applies or does not.

### `resolve_category_chains` — the first function this schema has carried

Migration `c9a41f7b0e83`. One plpgsql call resolves or creates every chain in the file; a 500-row
sheet naming eight chains is eight chains' work in one round trip instead of up to 3,000 probes.
It returns per-segment rows carrying a `conflict` code rather than raising — a raise would abort
the importer's transaction and take the good rows with it.

Three things in the body are load-bearing:

- **The `'00000000-…'::uuid` sentinel is INLINE, twice, never a plpgsql `CONSTANT`.**
  `uq_product_nodes_parent_name_lower` is an index on an EXPRESSION, and matching one needs the
  planner to see that expression. A literal always matches; a variable arrives as a parameter, and
  a GENERIC plan — which Postgres may switch to after the fifth execution, exactly when a session
  has been importing for a while — leaves `$1` unfolded and cannot. On the `INSERT` that is loud;
  on the `SELECT` it is silent, and the probe degrades to scanning every node in the database.
  ⚠ On a small dev tree the planner prefers a seq scan either way, so this cannot be caught by
  eye: `SET enable_seqscan = off` and confirm `Index Scan using uq_product_nodes_parent_name_lower`
  with all three expressions in the `Index Cond`.
- **`ON CONFLICT … DO NOTHING` returns no row**, so a lost race re-SELECTs what the winner wrote.
  Correct only under READ COMMITTED, which `core/database.py` runs — setting an `isolation_level`
  on that engine means revisiting this.
- **`depth` and `ancestor_ids` are computed exactly as `masters.service.create_node` computes
  them.** That module calls itself the only writer of those two columns; this is the second, and
  the three CHECKs are what catch it if they ever disagree. `models/product.py` warns a wrong
  `ancestor_ids` breaks technician eligibility SILENTLY — jobs simply stop being offered.

It is **additive**, with one deliberate exception: it will tick `is_leaf` on an existing node that
has no children, because that is the one edit the sheet genuinely asserts and refusing it would
strand a vendor who cannot edit a node staff created. Reported as `marked_leaf` so the console
names it before anybody confirms — never silent. ⚠ `sort_order` is left at 0 where `create_node`
computes `max + 1`; doing that per segment needs a correlated aggregate and a lock to be race-free,
for a column that only decides display order.

⚠ **`audit_tenancy` cannot read a plpgsql body.** It gained a fourth check for exactly this —
it refuses any `SECURITY DEFINER` function in `public` and names any function not in
`KNOWN_FUNCTIONS`, so a new one has to be added there with the invariant its body rests on. What
carries the weight inside is that `p_company_id` is always the principal's and never a request
value, every statement filters on it, and the composite self FK `fk_product_nodes_company_parent`
makes a node under another company's parent impossible rather than merely unchecked.

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

**For a VENDOR, `catalogue` is its own work, and `categories` is where it files new things.**
Keeping empty branches also kept every OTHER branch, so a brand-new vendor's "My products" opened
onto the company's whole tree — including sub-categories other vendors had created, whose names are
often their product line (*Samsung Washing Machines*). A vendor's `catalogue` now keeps a node that
holds one of its products, a node it created (`_vendor_user_ids`), and the ancestors of either —
nothing else. Every portal write still echoes cleanly: each touches a node that rule keeps. The
third purpose, `categories`, is the company's categories with no products at all (the model query
is not even run); the portal's "Add product" / "Add category" pickers read it, because the
category a vendor needs is usually one it has nothing in yet. ⚠ That picker still shows category
NAMES other vendors created — categories are company-wide and names are unique among siblings, so
hiding them would answer a vendor's same-named category with a 409 about a row it cannot see. A
vendor account whose membership names no vendor gets `[]` from `get_tree` and from
`lookup_serial`; both used to skip the pin and read it as "unrestricted".

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
  **A third dimension did land, for a different reason: `notifications.audience`.** A redemption
  is money only one role may pay, and a company-wide row would have rung every Area Manager for
  it — not cosmetic, the payer IS the audience. `'payers'` NARROWS a row to whoever holds
  `core.coverage.payer_role` (National Head, else Admin), resolved at READ time so a company's
  first National Head inherits the bell at once. A **role key** (`area_manager`, `regional_head`,
  `national_head`, `admin`) addresses one role and is resolved at WRITE time — a UPI change goes
  to whichever level of the AM → RH → NH → Admin chain exists — with the row's pincode keeping an
  AM- or RH-addressed row inside the territory that holds it. `'billing'` is Admins and National
  Heads together, with no fallback — either may recharge the company's credits. NULL is every other
  row, unchanged.
  ⚠ **Three places apply it and must agree:** `notifications.service._visible`,
  `core.coverage.users_notified_by` (web push — the relay passes `row.audience`) and the console
  socket's `_Visibility.hears_notification` (the `NotificationRaised` frame carries `audience`).
  An audience any of them does not know reaches nobody.
  **Four readers since Task 05 — and now there is a REFERENCE COPY.** `core/audience.py` is the
  pure rule in its memory shape (`hears(Reader, *, pincode, vendor_id, audience, franchisee_id)`,
  unit-tested in §6's `test_audience.py`); the SQL feed keeps its own mirror clause for clause, the
  coverage mirror does the same for push, and the socket delegates to `hears` outright — so the
  next audience branch is written ONCE, then mirrored twice, never three times.
  **`'franchisee_admin'` is the branch it joins, with the row's `franchisee_id` as its fourth
  fact** (`notifications.franchisee_id`, whose franchisee the row is ABOUT — the pairing the
  `vendor`/`audience` one makes for vendors, made here as an explicit CHECK because a Postgres
  FK pair cannot say "audience is franchisee_admin ⇒ id is not null… or is vendor"). Only an
  admin (or facility role, Task 12) of THAT franchisee hears such a row; a reader with
  `franchisee_id=None` — or a row with `franchisee_id=None` reaching a franchise reader — hears
  nothing, which is Task 02's closed leak restated in `hears` itself. `payers` rows of one
  franchisee's money ALSO reach that franchisee's admin through the franchise branch. An admin
  hearing a bell addressed `audience=franchisee_admin` still cannot act on a staff door — the
  doors themselves stay guarded by rank/feature, exactly like every other audience. **`'facility'`** (Task 12) is
  the fifth branch: a franchisee's admin and facility staff hear a part-request bell for THEIR franchisee only, and
  nobody in the staff shell does.
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

## Vendor brands — a vendor sells several, a product carries one

A vendor is a COMPANY; a brand is what is printed on the unit, and one company sells several
(Crestline Distributors sells *Meridian* and *Sunview*). Until `a4d8e61f2c07` the vendor's name WAS
the brand — `product_models.vendor_id` was documented as "the brand" and `/vendors/options` was
"the brand picker". Now:

    vendor_brands            one row per brand, per vendor; approval_status pending|approved|rejected
    product_models.brand_id  NOT NULL; FK (company_id, vendor_id, brand_id)
                             -> vendor_brands (company_id, vendor_id, id)

**The three-column FK is the point.** It makes a product whose brand belongs to a different vendor
structurally impossible, not merely refused by a service check. `uq_vendor_brands_company_vendor_id`
exists to be its target and doubles as the covering index for the vendor FK. `audit_tenancy`'s
composite check was widened to accept it: it now requires `company_id → company_id` plus the named
column, rather than exactly two columns.

**Backfill: every vendor's name became its first APPROVED brand, and every product got it.** So
nothing looked different on the day it shipped. The downgrade refuses (with counts) while any live
brand is not that vendor-named approved one, or while two brands' products share a name in one
category — dropping the column would silently merge them.

**Model names are unique per `(node_id, brand_id, lower(name))`** — two brands may each have a
"43 inch LED" in one category. `_assert_model_name_free` is scoped by brand to match, and so is the
console's `findModel`. Hand-written index, like every `lower()` one: autogenerate mistakes it for
stale.

**Two ways a brand appears, and only one is reviewed:**

| Who | Where | Status |
|---|---|---|
| Staff (`vendors.edit`, NH floor) | Vendors → the vendor form's Brands rows, `brands` on `POST`/`PUT /vendors` | **approved** at once — the people setting up the vendor are the approvers |
| The vendor (`vendor.catalogue`) | Portal → My brands, `/vendors/me/brands` | **pending** until an NH/Admin decides on Approvals → Brands |

A vendor's own brand follows the product approval flow above exactly — same guards (`CanApprove` +
`NationalHeadUp`), same ordering and `status` filter on `GET /masters/brand-approvals`, same 409
`ALREADY_DECIDED`, same reason rules, and `pending_count` (the rail badge) counts both kinds. A
vendor may rename a pending brand, fix-and-resubmit a rejected one (it goes back to pending and
rings staff again), and withdraw either. An **approved** brand is the office's: products may carry
it, so the portal routes 409 on it.

`PUT /vendors` sends the APPROVED brands whole (`[{id?, name}]`): a row with an id is kept or
renamed, one without is new, an approved brand left out is soft-deleted — **409 while a live
product carries it**, naming the brand and the count. Waiting brands are not that form's to decide;
leaving one out does nothing to it. At least one approved brand must remain.

**The ceiling (20) counts every live brand, waiting ones included**, in both `_apply_brands` and
`submit_own_brand`. Counting only approved ones would let a vendor hold 20 approved plus a pending
21st; approving it would leave a vendor the staff form cannot save, because `VendorBrandRows` caps
what it may send at 20.

**Only an APPROVED brand can go on a product.** `masters._resolve_brand` is the one check, used by
all four product writers: a given `brandId` must be this vendor's, live and approved, else a 400
that says which. **Omitted, it falls back to the vendor's only approved brand** — which is every
vendor from before brands existed, and what keeps an older console (and `deck/seed/seed_dev.mjs`)
saving products without knowing the field. With several, the caller must choose. A staff move to
another vendor moves the brand with it: the FK allows nothing else.

**A ticket reads its brand live through its model**, like `modelName` — `TicketOut.brandName`,
joined in `_hydrate`. Nothing is stamped on the ticket; unlike a price, a brand is not a term
anybody agreed to. The consequence to know: renaming a brand renames it on every old ticket too.

**People search by the name on the unit.** `vendors.service.brand_hit` — a correlated EXISTS on
the vendor AND its company, so it can only narrow a company-scoped query — makes both the Vendors
screen's search and the global search (`search.service._vendors_stmt`) find a vendor by any of its
live brands, waiting ones included. And `SerialMatchOut.brandName` lets the intake form's serial
lookup name the brand: two brands may each have a "43 inch LED" in one category, and without it
*"This serial belongs to 43 inch LED"* could name the model already selected.

**Three notification kinds**, the product ones' twins: `brand_submitted` (staff, `pincode=NULL`,
`to=/approvals?kind=brands`), `brand_approved` / `brand_rejected` (carry `vendor_id`,
`to=/portal/brands`, rewritten for a staff reader by `NotificationList.routeFor`).

⚠ **Never name anything bare `brand`.** `app.core.brand` is the company WHITE-LABEL module (see the
root AGENTS.md) and `tickets`, `jobs` and `vendors` already import it. It is `VendorBrand`,
`brand_names`, `brandName` here; `useOwnBrands`, never `useBrands`, in the console.

**The technician's job card names the brand only where it has to** — `core.product_label`. The app
draws `modelName` as it arrives, so `jobs._hydrate` sends *"Sunview · 43 inch LED"* when the
vendor's live products span more than one brand and the name does not already start with it, and
the bare name otherwise. No rebuild, and a single-brand vendor (every vendor from before brands)
reads exactly as before. Counted over products rather than approved brands: a second brand with
nothing filed under it cannot make two cards ambiguous. The console's `modelLabel` is the twin.

**Deliberately unchanged:** WhatsApp wording (the customer knows what they bought) and payout
reasons (written once at closure; an Earnings row is not where two units get confused).

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
⚠ **Since Task 05, that `nearest_manager_for` chain answers a HOME ticket only.** On a non-home
franchisee's ticket the reviewer is that franchisee's own admin (`penaltyReviewer.role =
'franchisee_admin'`), because its penalties sit in its pool — but the REVERSING door stays staff
(see below).
⚠ **The staff door is staff-only since Task 05**, and the penalty's own franchisee decides who
may give it back: the route carries `require_staff_principal` beside `penalties.reverse` and the
service refuses with **404 "Penalty not found"** when
`core.franchise_money.may_reverse(role, principal_franchisee_id, penalty.franchisee_id, home_id)`
is false — an AM or RH may reverse a HOME penalty (and only inside their territory, as above),
an Admin/NH any franchisee's, a franchise principal never here (its door is below, and the
filtered `penalties` list on the read already hid the row, so 404 answers it honestly).

**Two doors, one body.** Task 05 §4.10/§4.12 pulled the whole write into
**`core/penalty_reversal.py`** — the reason-length check, the profile-row lock, the once-only 409,
the reversal row (which copies BOTH of the penalty's stamps, `franchisee_id` AND
`technician_type`, so a technician who changed either since the charge cannot move the money),
the `penalty_reversed` ticket event and its wording (`₹… penalty to {name} reversed · {reason}`,
`actor_kind='staff'` whichever door rang it), the frame publishes and the post-commit push — so
the ticket page (staff, Door 1: `POST /tickets/{id}/penalties/{entryId}/reverse`) and the
franchisee's own Pool screen (Door 2:
`POST /franchise/ledger/{entryId}/reverse`, `franchise.pool`, own rows only) cannot drift. The
franchisee's door loads its penalty THROUGH its own stamp — a guessed or foreign `entryId` is a
404 — and `REVERSIBLE_KINDS` (`models/ledger.py`) is the list both pass: `("penalty", "speed_penalty")` since
Task 11, so a slow-job charge is given back by the same people through the same two doors. The reversal copies the
penalty's `franchisee_id`, so the money returns to the pool that collected it even if the technician has moved.

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
| `core.ledger.pool` | `reversal` is in `POOL_KINDS`; `penaltiesCollectedPaise` and `cancellations` are NET of it, so `collected − bonuses = balance` still holds and the console's sum line survives. The reversal is grouped by the KIND IT UNDID (a join to the reversed row), so a speed penalty given back nets out of `speedPenaltyPaise` and not out of `cancellations` |
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

## Push notifications are written in the phone's language

The technician app speaks English, Hindi, Telugu, Kannada and Tamil, and a closed app cannot
translate a push: Android draws the title and body exactly as this server sent them. So every
technician push is worded HERE, per phone.

- **The language is per device**, like the app's own setting: `push_tokens.language`, sent with
  every `POST /notifications/devices` and again whenever the technician switches. Absent or
  unknown is `en` — `core.push_text.normalize_language` — never a 422, because refusing a newer
  app's language would stop every push to that phone.
- **Callers pass a `PushText`, not a sentence:** `PushText("job.assigned", code=…, place=…,
  when=Slot(start, end))`. `send_to_technicians` renders it once per language among the
  recipients' phones. `Slot`, `Clock` and `TimeToSlot` are worded per language at render; codes,
  places, rupee amounts, catalogue names, UPI IDs and anything a person typed are shown as given.
- **Every message lives in `app/core/push_text.py`, in all five languages.** Adding a push means
  adding its key there with all five, following the app's glossary (`mobileapp/src/i18n/README.md`).
  The module checks itself at import — every language present, the same `{placeholders}` as
  English — so CI's `import app.main` fails on drift instead of a sweep failing silently.
- **English is unchanged** — each template is the sentence the call site used to build, and the
  English day and clock still come from `slots.when_label` / `slots.clock`.
- **WhatsApp is NOT localized.** Every technician message there is a Meta template, and a
  language is a separate approval per template in WhatsApp Manager — see "A registered template's
  wording is a deployment, not an edit". Until those exist, they stay `en` / `en_US`.

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

## Google Play review sign-in

Play's "App access" declaration requires a reviewer to get past sign-in, and a technician signs in
with a WhatsApp code sent to a registered phone the reviewer does not have. So **one number,
`PLAY_REVIEW_PHONE`, accepts one fixed code, `PLAY_REVIEW_CODE`, and is never sent anything**
(`app/core/play_review.py`, used by `otp_service.issue_code`). It covers every code issued to that
number for its own account — sign-in and adding a UPI ID — and nothing else: an invite code has no
account yet, and a reschedule code goes to a customer.

What keeps it from being a back door:

| Guard | Why |
|---|---|
| The number must be `+911…` | No Indian subscriber can hold one, so it is never a real person's account |
| The technician must belong to the company with slug `rgt-play-review` | A number pointed at another tenant by mistake gets an ordinary send, not a fixed code |
| Malformed or half-set = **off**, not a startup refusal | A typo here must not take the API down. `scripts/publish.py` refuses to deploy one instead, because "off" is silent until Google rejects the app |
| Expiry, throttles, burn-on-use and the five-attempt cap are unchanged | The fixed code is guessed no faster than a random one |

The company behind it — `RGT Play Review`, code `DEMO`, an admin, a vendor with **location check
off** (the reviewer is nowhere near the customer's door), the catalogue, `Demo Technician` on the
reviewer number, and jobs in every list — is built by:

```powershell
python -m app.scripts.seed_play_review                    # dev
$env:POSTGRES_DB='RelianceProdDB'; python -m app.scripts.seed_play_review --production
```

**The reviewer is a FREELANCER of the review company's HOME franchisee, and the script refuses (`SeedRefused`)
otherwise** — and refuses if the company has any franchisee besides its home: this is a fixed demo, and silently
undoing somebody's carve-out is worse than stopping before a submission. A reviewer carved into another
franchisee, or made an employee, would see a different Home, Earnings and Redeem. Give the reviewer a base
location, a spare-parts entry, a home facility operator (nothing in the staff shell works the parts queue, so
without one *Need a spare part* is hidden) and one job in *Awaiting part* — the script does all four; the
company's travel and speed rules stay at their ₹0 defaults.

It is safe to re-run and **must be re-run before every Play submission**: it creates only what is
missing, force-closes the reviewer's held jobs whose slot has ended (paying nothing), and adds fresh
pool, upcoming, in-progress and awaiting-part jobs, because a slotless pool job is offered for at most 48 hours. It
also keeps the demo vendor's credit line at the ceiling: every ticket reserves its price, and the default
₹5,000 refused a re-run partway through. It prints the
admin and vendor console passwords only when it creates those logins, or with `--reset-passwords`.
`cleanup_db` never deletes the company (see "What survives").

Both values live in `.env` and `.env.production` and are pasted into Play Console → App content →
App access. The number is entered without `+91`.

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
  title that supplies no suffix of its own). Since `job_escalation_v2`, neither reaches WhatsApp:
  the call site passes minutes and `build_escalation_payload` words them for both bodies.
- **A body may not start or end with a variable** — subcode `2388299`. It cost a submission on the
  feedback template, which is why `job_feedback` opens with "Your" and `job_escalation` with
  "Escalation" rather than with `{{1}}`.

Currently diverging on purpose: the registered `job_escalation` body says "reassign it", which is
wrong — nothing was ever assigned, so there is nothing to RE-assign, and the word sends a manager
hunting for a technician to replace. Its fallback now carries the `job_escalation_v2` wording
below, which says "assign a technician"; the approved v1 body keeps sending until v2 is approved
and named in `.env`.

And `job_accepted_manager`: its fallback already carries the v2 wording below, while the approved
v1 body keeps sending until v2 is approved and named in `.env`.

### `job_accepted_manager_v2` is APPROVED and configured — the manager's "job accepted" message, reworded

QA (bug 9, 2026-09-28) found the area manager's message hard to read:

> Hello Sneha The Manager, one of the jobs in your area has just been accepted.
> Technician1 has taken TC-INST-0005 in Ranga Reddy 500019, for Mon 28 Sep, 7:00–9:00 PM.
> Nothing needs doing. Open the Testing Company console if you want the full ticket, the
> customer's details, or to reassign it.

"Has taken" and "Nothing needs doing" are idiom, and the ticket, the area and the time run
together in one sentence. Those words are the APPROVED `job_accepted_manager` body, so they can only
change through Meta. Editing that template in place would also move it from four parameters to six
on whatever day Meta approves the edit, and every send between then and a deploy would fail with
`132000` (wrong number of values). Hence a **new name**, `job_accepted_manager_v2`, and a new setting,
`WHATSAPP_ACCEPTED_MANAGER_V2_TEMPLATE_NAME`, which wins over the old one when set. Until then
nothing changes for anybody except one parameter: v1's `{{4}}` now reads "ticket TC-INST-0005 in
Ranga Reddy 500019, with the visit on Mon 28 Sep, 7:00–9:00 PM".

Submitted 2026-10-13 and approved by Meta as UTILITY the same day; the setting below is in all three
env files, and one real send to an allowlisted number went through. What was submitted, for a
resubmission under a new name — WhatsApp Manager → Message templates → Create, category **UTILITY**, name
**`job_accepted_manager_v2`**, language **English (US) `en_US`** (the same as
`WHATSAPP_ACCEPTED_MANAGER_TEMPLATE_LANG`), no header, no footer, no buttons. Body, line breaks
exactly as shown:

```
Hello {{1}}, a technician has accepted a job in your area. No action is needed from you.

Ticket: {{2}}
Technician: {{3}}
Area: {{4}}
Visit: {{5}}

To see the full ticket and the customer's details, or to reassign the job, open the {{6}} console.
```

| | Parameter | Sample value for Meta |
|---|---|---|
| `{{1}}` | the manager's full name | `Sneha Rao` |
| `{{2}}` | ticket code | `TC-INST-0005` |
| `{{3}}` | technician's name | `Ravi Kumar` |
| `{{4}}` | ticket city and pincode | `Ranga Reddy 500019` |
| `{{5}}` | the visit window, or `Not fixed yet — the customer has not picked a time` | `Mon 28 Sep, 7:00–9:00 PM` |
| `{{6}}` | the company, from `brand.company_name` | `GreenTech Demo Services` |

Six variables in a body is how the FIRST `job_accepted_manager` submission was rejected (subcode
`2388293`, too many variables for the words). A labelled line needs its own variable — a parameter
may not hold a line break — so v2 pays in fixed words instead: 38, over six per variable, more than
the approved `job_accepted` (28 for five). It opens with "Hello" and ends on "console." for
`2388299`. If Meta still refuses on `2388293`, drop the `Area:` line and fold the area into `{{2}}`
(`TC-INST-0005, Ranga Reddy 500019`) — that is a code change in `build_job_accepted_manager_payload`
too, because the parameter list changes.

When Meta approves: set `WHATSAPP_ACCEPTED_MANAGER_V2_TEMPLATE_NAME=job_accepted_manager_v2` in
`api/.env`, `api/.env.dev-deploy` and `api/.env.production`, deploy, and send one to an allowlisted number (a wrong
parameter count is `132000`, and only a real send finds it). Leave the v1 name set — it is the
fallback if v2 is ever paused — and do not set v2 before approval: `publish.py` refuses a
configured name Meta has not approved, and a send under it fails with `132001`.

### `job_escalation_v2` is APPROVED and configured — the area manager's escalation, reworded

The approved `job_escalation` body makes a manager decode it:

> Escalation from GreenTech Demo Services: job TC-INST-0005 at Hyderabad 500019 still has no
> technician and the slot is in 2h 40m.
>
> Open the ops console to reassign it or add a bonus.

"Escalation from X:" is our queue's word, not theirs; "the slot is in 2h 40m" reads like code, and
read "in 0h 00m" once a slot had started; "the ops console" is internal wording where the
white-label rule wants the company's name; and "reassign" is wrong, because nothing was ever
assigned. Same remedy as `job_accepted_manager_v2`, for the same reason — four parameters become
five, so an in-place edit would fail every send with `132000` from the day Meta approved it until a
deploy: a **new name**, `job_escalation_v2`, behind a new setting,
`WHATSAPP_ESCALATION_V2_TEMPLATE_NAME`, which wins over `WHATSAPP_ESCALATION_TEMPLATE_NAME` when
set. Until then only v1's `{{4}}` changes: "in 2 hours 40 minutes", "already 20 minutes past its
start time", or "not set yet — the customer has not picked a time".

Submitted 2026-10-13 and approved by Meta as UTILITY the same day; the setting below is in all three
env files, and one real send to an allowlisted number went through. What was submitted, for a
resubmission under a new name — WhatsApp Manager → Message templates → Create, category **UTILITY**, name
**`job_escalation_v2`**, language **English (US) `en_US`** (the same as
`WHATSAPP_ESCALATION_TEMPLATE_LANG`), no header, no footer, no buttons. Body, line breaks exactly as
shown:

```
Action needed: a job in your area has no technician, and it is due soon.

Ticket: {{1}}
Area: {{2}}
Visit: {{3}}
Time left: {{4}}

Please assign a technician, add a bonus or change the visit time in the {{5}} console.
```

| | Parameter | Sample value for Meta |
|---|---|---|
| `{{1}}` | ticket code | `TC-INST-0005` |
| `{{2}}` | ticket city and pincode | `Ranga Reddy 500019` |
| `{{3}}` | the visit window, or `Not fixed yet — the customer has not picked a time` | `Mon 28 Sep, 7:00–9:00 PM` |
| `{{4}}` | time left to the slot, or with no slot to the SLA; `None — …` once it has passed | `2 hours 40 minutes until the visit starts` |
| `{{5}}` | the company, from `brand.company_name` | `GreenTech Demo Services` |

`{{4}}` is worded in `build_escalation_payload` from the minutes `core.escalation` passes, rounded
toward urgency (time left down, lateness up): `2 hours 40 minutes until the visit starts`,
`Less than a minute until the visit starts`, `None — the visit was due to start 20 minutes ago`,
and the same three against `the SLA deadline` for a ticket with no slot. The "None" shapes are
real: a technician giving a job back after its window opened escalates it (`jobs.service.cancel`).
That case is why the closing sentence names three ways out rather than two: for that job the
console refuses a bonus (`POOL_WINDOW_CLOSED`), but assigning a technician and changing the visit
time — the queue's Assign manually and Change the time — both still work, so the sentence stays
true for every message it closes.

Five variables against 35 fixed words — seven per variable, above `job_accepted_manager_v2` (38 for
six) and the approved v1 itself (23 for four) — for subcode `2388293`.
It opens with "Action needed" and ends on "console." for `2388299`. If Meta still refuses on
`2388293`, fold the area into `{{1}}` (`TC-INST-0005, Ranga Reddy 500019`) and drop the `Area:`
line — a code change in `build_escalation_payload` too, because the parameter list changes.

When Meta approves: set `WHATSAPP_ESCALATION_V2_TEMPLATE_NAME=job_escalation_v2` in `api/.env`,
`api/.env.dev-deploy` and `api/.env.production`, deploy, and send one to an allowlisted number (a
wrong parameter count is `132000`, and only a real send finds it). Leave the v1 name set — it is the
fallback if v2 is ever paused — and do not set v2 before approval: `publish.py` refuses a
configured name Meta has not approved (every `WHATSAPP_*_TEMPLATE_NAME` that is set, on the `prod`
target), and a send under it fails with `132001`.

### `technician_assigned` is configured

`WHATSAPP_TECHNICIAN_TEMPLATE_NAME=technician_assigned` is set in `api/.env`, `api/.env.dev-deploy`
and `api/.env.production`, so `sweep_customer_notice` sends it as a template. This section used to
say it was not registered and empty in both files; that was true when it was written and has not
been since. Meta's status was not re-checked when this was corrected — `publish.py` refuses a
production deploy naming a template Meta has not approved, and the `curl` under `slot_rescheduled`
below answers it directly. The body, five parameters, opening with "Your" for subcode `2388299`:

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

⚠ **The template is NOT approved, three times over.** Submitted 2026-09-10 as UTILITY / `en_US`,
id `2131819437688748`, and rejected `INCORRECT_CATEGORY` — twice: once as "You have been added as
a service technician with {{1}}. Install the technician app and sign in with this mobile number:
{{2}}…", and again after editing it into an account notice ("Your service technician account with
{{1}} has been created. Sign in with this mobile number to see your jobs: {{2}}…"). Meta's
classifier read both as MARKETING, so it was resubmitted as a fresh template
(`technician_app_link_v2`, same body, category MARKETING) on 2026-09-15 — rejected
`INCORRECT_CATEGORY` again. A third try (`technician_app_link_v3`, MARKETING, the OTP-mention
sentence removed in case that was read as an AUTHENTICATION signal) was also rejected
`INCORRECT_CATEGORY`. Three attempts, three categories effectively disagreed with by the same
classifier — this is not a wording problem the API side can iterate its way out of; it needs a
human review request in WhatsApp Manager, not another automated submission.

**Standing in until then: `WHATSAPP_APP_LINK_TEMPLATE_NAME=technician_invite`**, in both `.env`
files, as of 2026-09-15. Reusing the invite's own template means a direct-add technician now reads
"You have been invited… Complete your registration…" — wrong on both counts, since they were
already registered by a manager and never invited — but it delivers outside the 24-hour window,
where the free-form fallback silently does not. Revert `WHATSAPP_APP_LINK_TEMPLATE_NAME` to empty
the moment a correctly-worded template is approved, and make `build_app_link_payload`'s fallback
say the same thing that template does. Only add the name to `publish.py`'s must-be-set list once
that happens — a stand-in borrowed from another slot's template is not the real thing being live.
