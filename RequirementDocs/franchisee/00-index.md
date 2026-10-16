# Franchisee model — index, decisions and the names every task must use

> **Read this file before any task document.** It is the single source of truth for the decisions and for
> every table, column, status, ledger kind, role and feature key the 16 tasks introduce. A task document
> that disagrees with the **Names** table below is wrong; fix the task doc, not this table.

Written 2026-10-15 from a grilling session with the product owner. Branch base: `dev` @ `6763026`.

---

## 1. What is changing, in plain words

Until now every technician was a freelancer the company managed directly: an Area Manager added them, the
National Head paid them by UPI, and every closed job paid the product's `technician_payout_paise`.

Now **every company runs franchisees**, and **a franchisee runs the technicians**.

> **Worked example.** *Acme Appliances* (a company on the platform) has three franchisees:
> - **Acme Appliances** (code `HOME`) — the home franchisee: created automatically, internal, named after the company, owns every pincode nobody else claims.
> - **Acme Secunderabad** — internal, owns 500003–500015 and 500025.
> - **SkyFix Services** — external (a separate business leasing the Acme name), owns 500030–500040.
>
> A ticket for 500032 is stamped **SkyFix**. Only SkyFix's technicians are offered it. When SkyFix's
> freelancer Ravi closes it, the payout, his travel allowance (he lives 27 km away) and his speed reward
> (he finished in 9 hours) are written to the ledger **against SkyFix**. SkyFix's franchisee admin pays
> Ravi's redemption by UPI. Acme's Area Manager for Telangana can still reschedule or force-close the
> ticket — tickets stay company work — but cannot edit Ravi or see SkyFix's money.

Three features ride on the franchisee:

| Feature | One line |
|---|---|
| **Travel allowance** | Beyond a free distance (20 km freelancer / 30 km employee by default), pay ₹X for every step of 1 or 2 km, from the technician's base location to the customer. |
| **Speed allowance** | Finish a job fast → reward; slow → penalty. Thresholds and ₹ per franchisee × technician type × category/product. |
| **Spare parts** | The technician picks a part from the category's list (or "Other"), the franchisee's facility approves, issues the new part, and logs the old part coming back. |

---

## 2. Decisions (owner-approved — do not re-litigate)

### 2.1 Franchisee structure

| # | Decision |
|---|---|
| F1 | Two kinds: `internal`, `external`. Every company has exactly one **home** franchisee: internal, created with the company, cannot be deleted or made external. |
| F2 | A franchisee is configured with **pincode ranges**: `from–to` numeric ranges and single codes, e.g. `500001-500099, 500120`. The server expands them against the `pincodes` master and stores only codes that exist (and are active). |
| F3 | **No overlap.** Saving a range that includes a code another franchisee owns is refused (409 `FRANCHISEE_PINCODE_TAKEN`) and names the clashing codes and owners. |
| F4 | **The home franchisee is the catch-all.** It stores **no** `franchisee_pincodes` rows; it owns every pincode no other franchisee owns. A ticket can therefore never be without a franchisee. |
| F5 | **Migration:** each existing company gets its home franchisee; every technician, ticket, ledger entry, redemption and invite is stamped with it; every technician becomes a `freelancer`. Nothing visible changes on the day it ships. |
| F6 | **Carve-out.** When a franchisee is given pincodes: technicians (of any other franchisee) whose coverage lies **entirely** inside the new set **move** to the new franchisee; technicians with **some** coverage inside **lose those pincodes** (but keep at least one — a technician who would be left with zero coverage moves instead). Open **unassigned** tickets (`New`, `Slot Pending`, `technician_id IS NULL`) in those pincodes are re-stamped. Assigned jobs keep their technician and their franchisee. The save response previews this before commit (`dryRun=true`). Removing pincodes from a franchisee hands them back to home with the same rules. |
| F7 | **Split of duties.** Company staff (Admin, NH, RH, AM) keep working **tickets** exactly as today: escalations, reschedule, force-close, assign, the dashboard. The **franchisee admin** owns **technicians and their money** for that franchisee: add, invite, edit, type, base location, UPI change approval, redemption payment, penalty reversal, the pool, travel and speed settings, employee statements, facility users. |
| F8 | **Home franchisee proxy.** For the **home** franchisee, technician management and money keep today's rules exactly (AM/RH/NH/Admin as now, NH-else-Admin pays). A home franchisee may *also* be given franchisee admins, who then hold the franchisee-admin powers alongside. Non-home franchisees: only their own franchisee admins (plus company Admin/NH for **penalty reversal** and read-only views). **No company fallback for a non-home franchisee's UPI changes or redemptions** — the last active franchisee admin of a non-home franchisee cannot be deactivated or removed (409 `FRANCHISEE_LAST_ADMIN`, *owner ruling 2026-10-15*). |
| F9 | Company **Admin or National Head** create franchisees and franchisee-admin logins (the login is created with a generated, emailed temporary password, like a vendor login). |
| F10 | Franchisee admins and facility staff sign in to the **same console** and land in a **restricted portal** (`/franchise/*`), a third shell beside staff and vendor. |
| F11 | Money between an **external franchisee and the company** (lease fee, revenue share) is **out of scope**. Every technician rupee carries `franchisee_id` so it can be reported later. |
| F12 | **One penalty pool per franchisee**: `balance = penalties + speed_penalties − reversals − bonuses − speed_rewards`, scoped by `ledger_entries.franchisee_id`. |
| F13 | A franchisee admin sees **its own franchisee's tickets read-only** (list + detail, no actions). Facility staff see tickets that have a part request. |

### 2.2 Technician type

| # | Decision |
|---|---|
| T1 | `technician_type` ∈ `employee`, `freelancer`. Default `freelancer`. Set by whoever adds/invites the technician; changeable by the franchisee admin (home: by `technicians.edit` holders). A change affects jobs **accepted after** it (the type is frozen in `accept_snapshot`). **Settled as built (owner ruling 2026-10-15):** freelancer → employee is refused while redeemable money remains (409 `TECHNICIAN_HAS_BALANCE`) **and** while the technician holds an open job (409 `TECHNICIAN_HAS_OPEN_JOBS`). |
| T2 | **Employees get no per-job payout** — neither on customer closure nor force-close. Still stamped on the ticket (it is the product's price). |
| T3 | Employees **do** get travel allowance, speed reward/penalty, cancellation penalties and escalation bonuses. |
| T4 | Employees **cannot redeem** (409 `EMPLOYEE_CANNOT_REDEEM`). The franchisee admin downloads a **monthly statement** per employee (CSV, IST calendar month) to add to salary. Salary itself is not recorded. |

### 2.3 Travel allowance

| # | Decision |
|---|---|
| TA1 | Distance = straight line (`api/app/core/coordinates.metres_between`) × **road factor**, **one way**, base → customer. |
| TA2 | Customer point: `tickets.latitude/longitude` if present, else `pincodes.latitude/longitude` of `tickets.pincode`. **Trust the data**: if neither exists, distance is **0 km** (recorded with reason `no_customer_point`). |
| TA3 | Settings per **franchisee × technician type**: `free_km`, `step_km`, `paise_per_step`, `road_factor_pct`, `max_paise_per_job`. Partial steps are **dropped**. Amount = `min(max, floor(max(0, km − free_km) / step_km) × paise_per_step)`. |
| TA4 | Defaults (in code, stamped on franchisee creation): freelancer free 20 km, employee free 30 km; step 1 km; road factor 130 %; ₹0 per step; ₹0 max → **off until configured**. |
| TA5 | **Frozen at accept** into `tickets.accept_snapshot.travel` (base point and its source, customer point and its source, km, rates, computed amount). A base moved later never restates an accepted job. Re-stamped if the job is reassigned/released and accepted again. |
| TA6 | **Paid on customer closure** as ledger kind `travel` (not a pool kind). Force-close: the form shows the frozen amount pre-filled; the manager may change it, capped at the frozen `max_paise_per_job`; 0 writes no row. Cancelled: nothing. |
| TA7 | **Base location** on the technician: set by the franchisee admin (console map pin, Leaflet + OpenStreetMap) or by the technician (onboarding step, Profile → Base location, Home card until set). **No approval flow and no cooldown for a self-set base (owner ruling 2026-10-15):** the source and who set it are stored and SHOWN to the franchisee admin (and home managers) as a chip (*Pincode / GPS / Map / Set by admin*), the admin can correct it at any time, and frozen accept snapshots are never restated. In the app: pick a **home pincode inside the franchisee's range** → its centre is used; if the technician lives **outside** the range → **OpenStreetMap pin** in a WebView, or "Use my current location" (GPS). |
| TA8 | No base location at accept → allowance ₹0 with reason `no_base_location`. Accepting is **not** blocked. |

### 2.4 Speed allowance

| # | Decision |
|---|---|
| S1 | A **full matrix at franchisee level**: rows keyed by franchisee × technician type × (category node **or** product model), each holding `reward_within_hours`, `penalty_after_hours`, `reward_paise`, `penalty_paise`. |
| S2 | Resolution for a ticket: the row for the ticket's **model** wins; else the row for the **deepest** node on `node_path_ids`; else **no speed rule** (nothing paid or charged). |
| S3 | **Clock: from the LATER of the accept and the confirmed slot's start → completed** *(owner ruling 2026-10-15)*. `accepted` = the latest `assigned` ticket event; the slot is `tickets.slot_start` as in force at completion (a reschedule moves it, so the latest slot counts); `completed` = the `completed` event (technician pressed Complete). **Minus time spent in `Awaiting Part`** (waits before the clock start are ignored). No slot → from the accept. Slot start after completion → 0 h. **Example:** accepted Mon 11:00, slot Thu 10:00–12:00, completed Thu 13:00 → **3 h**. |
| S4 | Duration ≤ `reward_within_hours` → `speed_reward`; > `penalty_after_hours` → `speed_penalty`; between → nothing. |
| S5 | Frozen at accept (`accept_snapshot.speed`), measured at completion, **written on customer closure**. **No speed money on force-close** *(settled by the owner 2026-10-15)*. |
| S6 | Both are **pool kinds**: `speed_reward` is paid from the franchisee's pool like a bonus; `speed_penalty` funds it like a penalty, **counts against the monthly cancellation cap** (`cancel_penalty_cap_paise`), and is **reversible** by the same people and flow as a penalty. |

### 2.5 Spare parts

| # | Decision |
|---|---|
| P1 | Catalogue on **category nodes**, inherited by every node and product beneath; a **product model** may add its own. Maintained by company Admin/NH (feature `parts.catalogue`). |
| P2 | Request raised by the technician **only after the job has started** (`In Progress`, or `Awaiting Part` for a second part): pick from the inherited list, or **Other** + a typed name. Optional note. Several requests per job allowed. |
| P3 | Raising a request moves the job **`In Progress → Awaiting Part`**. Complete is refused while any request is `requested` or `approved`. When every request is `issued`, `returned` or `rejected`, the job returns to `In Progress`. A revisit time uses the existing reschedule — which today refuses a started job, so Task 12 widens both reschedule paths to allow `In Progress`/`Awaiting Part` (status unchanged by the move). |
| P4 | States: `requested → approved | rejected`, `approved → issued | rejected`, `issued → returned` *(owner ruling 2026-10-15: a facility may reject an APPROVED request, with a reason; the job returns to In Progress once no request is requested/approved)*. **Facility staff log every step** (approve/reject, "new part issued to technician", "old part received back"). The technician only raises the request. |
| P5 | No money, no stock counts. Only the log: who, when, optional note/photo. |
| P6 | Facility roles are **franchisee staff**. `facility_admin` and `facility_operator` can both approve, reject and log. A facility admin can also create/deactivate facility operators. The franchisee admin creates facility admins (and may do everything a facility admin can). **For the HOME franchisee the company's Admin / National Head may also create facility users** (feature `franchisees.manage`) — it needs someone to add its first facility admin *(owner ruling 2026-10-15)*. |
| P8 | **No Admin/NH fallback for parts (owner ruling 2026-10-15).** Nobody in the staff shell works the parts queue, the home franchisee included. A franchisee with **no active `facility_admin` or `facility_operator`** cannot have a part requested: 409 `NO_FACILITY`; the technician API says so with `partsEnabled` and the app hides/disables *Need a spare part* with an explanatory line. |
| P7 | Approving an **Other** request offers **"Add "<name>" to <category>'s parts list"** — one click creates the `spare_parts` row on the ticket's leaf node and links the request to it. |

### 2.6 Pincode coordinates

| # | Decision |
|---|---|
| G1 | `pincodes.latitude` / `pincodes.longitude` already exist in RelianceDB (19,195 of 19,496 filled) at Alembic revision **`f9c2d8a3e17b`**, whose file is **not yet in this repo**. The owner will push that branch (Task 00). Every migration here chains after it. |
| G2 | Trust the data. Missing → 0 km. No district fallback. (Known: some points are off — e.g. 500032 is ~40 km from Gachibowli. A superadmin correction screen is a possible later task, not this one.) |

### 2.7 Process

| # | Decision |
|---|---|
| X1 | **Tests:** `pytest` for **pure-function unit tests only — no database** in `api/tests/unit/`. `vitest` for `adminWeb/`. `jest-expo` for `mobileapp/`. All three run in CI. Database behaviour is proven by each task's **acceptance criteria** (manual/scripted against RelianceDB) and by new checks in `api/app/scripts/seed/verify.py`. |
| X2 | **Copy:** no prototype covers these screens. Each task doc lists **PROPOSED** English strings; the owner signs them off before the client task is built. Mobile strings go into all five `mobileapp/src/i18n/locales/*.json` (translated per `src/i18n/README.md`, queued for native review). |
| X3 | **Native modules:** only `react-native-webview` is added (for the OSM pin). It is in Expo Go but needs a new Play build — flagged per root AGENTS.md. No `react-native-maps`. |
| X4 | **APK forward-compatibility:** installed apps crash on an unknown ledger kind or ticket status. **Task 07 (mobile) must be live on Play before the API writes `travel`, `speed_reward`, `speed_penalty` or `Awaiting Part`** (Tasks 10–12 deploy). |
| X5 | Hard rules from root `AGENTS.md` and `api/AGENTS.md` apply unchanged: tenancy (composite FKs, 404 not 403), money in integer paise, every FK has a covering index, partial UNIQUE on soft-deleted tables, no table without a writer, migrations hand-written and round-trip tested on dev, **prod migrated by the owner** before the API is published. |

---

## 3. Names (canonical — every task uses exactly these)

### 3.1 New tables

| Table | Task | Purpose |
|---|---|---|
| `franchisees` | 01 | `id, company_id, name, code, kind ('internal'|'external'), is_home, contact_name, contact_phone, contact_email, is_active, deleted_at` + audit. `uq_franchisees_company_id_id` (total). One home per company: partial unique `uq_franchisees_one_home ON (company_id) WHERE is_home AND deleted_at IS NULL`. Name unique per company on `lower(name)` where `deleted_at IS NULL`. `code` String(8), unique per company, stamped once. |
| `franchisee_pincodes` | 01 | `id, company_id, franchisee_id, pincode` (String(6) FK → `pincodes.code` RESTRICT). `uq_franchisee_pincodes_company_pincode (company_id, pincode)` — the no-overlap rule. Never holds rows for the home franchisee. |
| `franchisee_travel_rules` | 10 | `id, company_id, franchisee_id, technician_type, free_km, step_km, paise_per_step, road_factor_pct, max_paise_per_job`. Unique `(company_id, franchisee_id, technician_type)`. Two rows per franchisee, stamped at creation. |
| `franchisee_speed_rules` | 11 | `id, company_id, franchisee_id, technician_type, node_id NULL, model_id NULL, reward_within_hours, penalty_after_hours, reward_paise, penalty_paise`. CHECK exactly one of node/model. CHECK `penalty_after_hours >= reward_within_hours`. Partial uniques per (company_id, franchisee_id, technician_type, node_id) and (company_id, franchisee_id, technician_type, model_id). |
| `spare_parts` | 12 | `id, company_id, node_id NULL, model_id NULL, name, is_active, deleted_at`. CHECK exactly one of node/model. Unique `lower(name)` per node / per model where `deleted_at IS NULL`. |
| `technician_transfers` | 17 | Audit of manual technician moves: `company_id, technician_id, from_franchisee_id, to_franchisee_id, reason, transferred_by_user_id, transferred_at` + composite FKs and covering indexes. Written in the same transaction as the move; downgrade refuses while rows exist. |
| `spare_part_requests` | 12 | `id, company_id, code, franchisee_id, ticket_id, technician_id, spare_part_id NULL, other_name NULL, part_name (frozen label), note, status, decided_at, decided_by_user_id, decided_by_label, reject_reason, rejected_from ('requested'|'approved'; owner ruling 2026-10-15), issued_at, issued_by_user_id, issued_by_label, issue_note, returned_at, returned_by_user_id, returned_by_label, return_note, return_photo_blob_name`. CHECK exactly one of spare_part_id/other_name. |

### 3.2 New columns on existing tables

| Table.column | Task | Notes |
|---|---|---|
| `memberships.franchisee_id` | 01 | NULL for everyone except franchise roles. Composite FK `(company_id, franchisee_id)`. |
| `technician_profiles.franchisee_id` | 01 | NOT NULL after backfill. Composite FK. |
| `technician_profiles.technician_type` | 01 | NOT NULL, default `'freelancer'`, CHECK `IN ('employee','freelancer')`. |
| `technician_invites.franchisee_id`, `technician_invites.technician_type` | 01 | Copied to the profile at registration. |
| `tickets.franchisee_id` | 01 | NOT NULL after backfill. Stamped at intake from the pincode (Task 04). |
| `tickets.accept_snapshot` | 10 | JSONB NULL. Written on accept/assign. Keys below. |
| `tickets.routing_override` | 18 | boolean NOT NULL DEFAULT false. Derived server-side (`target franchisee != owner of the pincode`) when staff hand an unassigned ticket to another franchisee; waives ONLY the pincode-coverage half of eligibility. Never sent by a client. |
| `ledger_entries.franchisee_id` | 01 | NOT NULL after backfill. = the **technician's** franchisee at write time (the payer) — **except a `reversal`, which copies the reversed entry's franchisee** so money returns to the pool that collected it. Set inside `core/ledger.entry`. |
| `ledger_entries.technician_type` | 05 | The writer's type at write time (`employee`/`freelancer`), so a statement and the pool stay truthful after a type change. |
| `redemptions.franchisee_id` | 01 | NOT NULL after backfill. = the technician's franchisee when requested. |
| `notifications.franchisee_id` | 05 | NULL. Scopes `franchisee_admin` / `facility` audiences. |
| `technician_profiles.base_latitude`, `base_longitude`, `base_pincode`, `base_source`, `base_set_at`, `base_set_by_user_id` | 10 | Lat/long both-or-neither, India bounds (as `tickets`). `base_source IN ('pincode','gps','map','manual')`. |

### 3.3 Vocabularies

| Thing | Values added | Task |
|---|---|---|
| Roles (`roles` rows, appended ranks) | `franchisee_admin` (rank 8, "Franchisee Admin"), `facility_admin` (9, "Facility Admin"), `facility_operator` (10, "Facility Operator") | 02 |
| Python role sets (`app/models/role.py`) | `FRANCHISE_ROLES = {franchisee_admin, facility_admin, facility_operator}`, `FACILITY_ROLES = {facility_admin, facility_operator}` | 02 |
| `franchisees.kind` | `internal`, `external` | 01 |
| `technician_type` | `employee`, `freelancer` | 01 |
| Ledger kinds (`LEDGER_KINDS`) | `travel`, `speed_reward`, `speed_penalty` | 10, 11 |
| `POOL_KINDS` | add `speed_reward`, `speed_penalty` (`travel` is **not** a pool kind) | 11 |
| Reversible kinds | `penalty`, `speed_penalty` | 11 |
| Ticket status | `Awaiting Part` (non-terminal) | 12 |
| `ticket_events.kind` | `franchisee_changed` (CHECK widened in Task 01's migration; written by 03/04), `speed_settled` (11), `part_requested`, `part_approved`, `part_rejected`, `part_issued`, `part_returned` (12). Every migration that rewrites this CHECK must list ALL earlier kinds, including these. | 03, 11, 12 |
| `spare_part_requests.status` | `requested`, `approved`, `rejected`, `issued`, `returned` | 12 |
| `notifications.audience` | `franchisee_admin` (05), `facility` (12) | 05, 12 |
| `notifications.kind` (column is `String(24)` — every new kind ≤ 24 chars) | `technician_moved` (CHECK widened in Task 01's migration; written by 03), `part_requested`, `part_decided`, `part_issued` (12) | 03, 12 |
| `upi_change_requests.reviewer_role` | add `franchisee_admin` | 05 |
| Error codes | `FRANCHISEE_PINCODE_TAKEN`, `FRANCHISEE_HOME_IMMUTABLE`, `FRANCHISEE_HAS_TECHNICIANS`, `PINCODE_OUTSIDE_FRANCHISEE`, `EMPLOYEE_CANNOT_REDEEM`, `TECHNICIAN_HAS_BALANCE`, `TECHNICIAN_HAS_OPEN_JOBS` (409, Task 05 — was missing here), `FRANCHISEE_LAST_ADMIN` (409, Task 03 — refuses deactivating/removing the last active franchisee admin of a NON-home franchisee; owner ruling 2026-10-15), `BASE_OUTSIDE_INDIA`, `PINCODE_HAS_NO_LOCATION`, `PART_REQUEST_NOT_IN_PROGRESS`, `PARTS_PENDING`, `PART_REQUEST_BAD_STATE`, `NO_FACILITY` (409, Task 12 — a technician raised a part request against a franchisee with no active facility admin/operator; owner ruling 2026-10-15) | as named |

### 3.4 Feature keys (`features` + `role_feature_defaults`)

| Key | Default holders | Task |
|---|---|---|
| `franchisees.manage` | admin, national_head | 02/03 |
| `franchisees.view` | admin, national_head, regional_head, area_manager | 02/03 |
| `franchise.technicians` | franchisee_admin | 02/05 |
| `franchise.payouts` (redemption pay, UPI approvals) | franchisee_admin | 02/05 |
| `franchise.pool` | franchisee_admin | 02/05 |
| `franchise.settings` (travel + speed rules) | franchisee_admin | 02/10/11 |
| `franchise.statements` | franchisee_admin | 02/06 |
| `franchise.tickets` (read-only) | franchisee_admin, facility_admin, facility_operator | 02/04 |
| `franchise.facility_users` | franchisee_admin, facility_admin | 02/12 |
| `parts.handle` | franchisee_admin, facility_admin, facility_operator | 02/12 |
| `parts.catalogue` | admin, national_head | 02/12 |

Home-franchisee money and technician screens stay on the existing keys (`technicians.*`, `redemptions.pay`, `earnings.view`, …) per F8. **No new key for staff creating the HOME franchisee's facility users** (owner ruling 2026-10-15): they ride `franchisees.manage` (admin, national_head), through staff routes that always resolve the home franchisee server-side (Task 12 §4.8b). `parts.handle` is **never** granted to a staff role.

### 3.5 `tickets.accept_snapshot` (JSON, camelCase keys) — written by Task 10, extended by Task 11

```json
{
  "acceptedAt": "2026-10-15T05:30:00Z",
  "technicianId": "…",
  "franchiseeId": "…",
  "technicianType": "freelancer",
  "travel": {
    "basePoint": {"lat": 17.44, "lng": 78.35, "source": "pincode"},
    "customerPoint": {"lat": 17.41, "lng": 78.55, "source": "pincode"},
    "straightKm": 21.6, "roadFactorPct": 130, "km": 28.1,
    "freeKm": 20, "stepKm": 2, "paisePerStep": 1000, "maxPaisePerJob": 30000,
    "amountPaise": 4000, "reason": null
  },
  "speed": {
    "ruleId": "…", "matchedOn": "node", "matchedId": "…",
    "rewardWithinHours": 12, "penaltyAfterHours": 24,
    "rewardPaise": 20000, "penaltyPaise": 15000
  }
}
```

`travel.reason` ∈ `null`, `no_base_location`, `no_customer_point`. `speed` is `null` when no rule matched. **No slot field is stored** (owner ruling 2026-10-15, R1): the speed clock starts at `max(acceptedAt, tickets.slot_start)` and the slot is read from the ticket at settlement, because a reschedule legitimately moves it — only `acceptedAt` is frozen.
Read through a helper (`app/core/accept_snapshot.py`) — never with a bare `[]` — so old tickets (snapshot NULL) read as "nothing to pay".

### 3.6 Migrations (linear chain — apply in this order)

| Order | Revision | File | down_revision | Task |
|---|---|---|---|---|
| 0 | `f9c2d8a3e17b` | (owner's branch) pincodes get coordinates | `ea2fb2654b95`? — whatever the owner's file says | 00 |
| 1 | `3b7e1f0a9c41` | `3b7e1f0a9c41_every_company_has_franchisees.py` | `f9c2d8a3e17b` | 01 |
| 2 | `5d2a8c6e0b13` | `5d2a8c6e0b13_franchise_roles_and_features.py` | `3b7e1f0a9c41` | 02 |
| 3 | `7c4f2e9a1d58` | `7c4f2e9a1d58_franchisee_admins_review_and_are_notified.py` | `5d2a8c6e0b13` | 05 |
| 4 | `9e1b5d3c7a26` | `9e1b5d3c7a26_travel_allowance.py` | `7c4f2e9a1d58` | 10 |
| 5 | `b4a8e2f6c903` | `b4a8e2f6c903_speed_allowance.py` | `9e1b5d3c7a26` | 11 |
| 6 | `d6c3a9f1e874` | `d6c3a9f1e874_spare_parts.py` | `b4a8e2f6c903` | 12 |
| 7 | `e8a2c5b7d913` | `e8a2c5b7d913_technician_transfers.py` | `d6c3a9f1e874` | 17 |
| 8 | `f3b9d1a6c845` | `f3b9d1a6c845_hand_ticket_to_franchisee.py` | `e8a2c5b7d913` | 18 |

If tasks land out of order, the implementing agent re-points `down_revision` to the current head and says so in the commit — never a branch in the chain.

### 3.7 Shared helpers (names fixed so parallel tasks agree)

| Module | Symbol | Task | What |
|---|---|---|---|
| `app/models/franchisee.py` | `Franchisee`, `FranchiseePincode`, `KIND_INTERNAL`, `KIND_EXTERNAL`, `KINDS` | 01 | ORM |
| `app/models/technician.py` | `TYPE_EMPLOYEE`, `TYPE_FREELANCER`, `TECHNICIAN_TYPES` | 01 | constants |
| `app/core/franchise.py` | `home_franchisee_id(db, company_id) -> UUID` | 01 | the company's home |
| | `create_home_franchisee(db, company) -> Franchisee` | 01 | used by `create_company` and the backfill's logic mirror |
| | `franchisee_for_pincode(db, company_id, pincode) -> UUID` | 01 | owner row else home |
| | `franchisee_pincodes_subquery(company_id, franchisee_id, *, is_home)` | 01 | SQL: codes a franchisee owns (home = active master codes NOT IN any other franchisee's rows) |
| `app/core/franchise.py` (cont.) | `franchisees_for_pincodes` (batch, importer), `restamp_ticket`, `lock_routing(db, company_id, *, exclusive)` (advisory lock: exclusive for carve-outs, shared for intake and coverage checks), `assert_pincodes_in_franchisee` | 01/03/04 | |
| `app/core/franchise_logins.py` | `create_login`, `reissue_password`, `set_active`, `mail_password`, `login_base`, `last_active`, `blocks_last_admin` (pure) / `active_admin_count` (owner ruling 2026-10-15, R3) | 03 | shared by 03 and 12 |
| `app/core/carve_out.py`, `app/core/franchise_routing.py` | pure carve-out planner and routing decisions | 03/04 | pure, unit-tested |
| `app/core/audience.py`, `franchise_money.py`, `penalty_reversal.py`, `employment.py`, `statements.py` | `audience.hears` (one rule, used by all four notification readers), money visibility, shared penalty reversal, `pays_per_job` / `may_redeem`, statement builder | 05/06 | see Tasks 05, 06 |
| `app/core/technician_transfer.py`, `app/models/technician_transfer.py`, `features/technicians/transfer_service.py`, `core.ledger.open_redemption_exists` | pure transfer decider, model, service, helper | 17 | push key `technician.moved` |
| `app/core/franchise_handover.py`, `coverage.technicians_by_franchisee`, `restamp_ticket(release_override=)`, `technicians_covering(routing_override=)`, `PoolChanged.routing_override` | pure handover decider and the override plumbing | 18 | notification kind `ticket_handed` (13 chars) |
| `app/core/pincode_ranges.py` | `parse_pincode_ranges(text: str) -> list[tuple[int,int]]`, `expand(ranges, existing: set[str]) -> set[str]`, `compress(codes) -> str` | 03 | **pure**; unit-tested |
| `app/core/deps.py` | `Principal.franchisee_id`, `Principal.is_franchise`; `require_franchise_principal` / `FranchisePrincipal` = **franchisee_admin ONLY**; `require_facility_principal` / `FacilityPrincipal` = **any of the three franchise roles** (parts work). Feature keys still gate each route. | 02 | auth |
| `app/core/franchise_scope.py` | `managed_franchisee_ids(db, principal, *, purpose='manage'|'view'|'reverse') -> set[UUID] | None` (None = all in company), `can_manage_technician(db, principal, tech) -> bool` | 02 | F7/F8 in one place |
| `app/core/travel.py` | `TRAVEL_DEFAULTS`, `travel_amount_paise(km, free_km, step_km, paise_per_step, max_paise) -> int`, `road_km(straight_m, road_factor_pct) -> float` | 10 | **pure** |
| `app/core/travel_rules.py`, `app/core/base_location.py` | `technician_type_of`, `closure_travel_paise`, `force_close_travel_paise`, base-location validation | 10 | see Task 10 |
| `app/core/speed.py` | `speed_outcome(duration_h, rule) -> ('reward'|'penalty'|None, paise)`, `clock_start(assigned_at, slot_start) -> datetime` (the later of the two; owner ruling 2026-10-15), `working_hours(clock_start, completed_at, part_wait_intervals) -> float`, `clock_from_events(events, slot_start=None)` (reads `Awaiting Part` spans off `status_changed` from/to — the only extractor; `slot_start` is the ticket's slot in force, passed as data), `resolve_speed_rule`, `SpeedTerms` | 11 | **pure** |
| `app/core/speed_rules.py`, `app/core/speed_settle.py` | matrix resolution; settlement on closure (DB) | 11 | see Task 11 |
| `app/core/accept_snapshot.py` | `build_accept_snapshot(db, ticket, technician, now) -> dict`, `travel_of(snapshot)`, `speed_of(snapshot)` | 10/11 | stamping + safe reads |
| `app/features/franchisees/` | `router.py`, `service.py`, `schemas.py` | 03 | management API, prefix `/franchisees` |
| `/franchise/*` routes | Portal twins live as **second routers inside the slice that owns the logic** (technicians — incl. `/franchise/technicians/{id}/base-location` —, redemptions, ledger…) so slices never import each other; `app/features/franchise_portal/` holds only portal-native endpoints: technician-options and pincodes (05), statements (06), `settings/travel` (10), `settings/speed*` (11), `facility-users` (12) | 05/06/09/10/11/12 | franchise principals |
| `app/models/franchisee.py` (+ `FranchiseeTravelRule`), `app/models/franchisee_speed_rule.py`, `app/models/spare_part.py` | ORM for the three tables of §3.1 not owned by Task 01 | 10/11/12 | |
| `app/models/ledger.py` | `REVERSIBLE_KINDS`, `CAPPED_KINDS`, `SPEED_KINDS` (Task 11 moves Task 05's `core.penalty_reversal.REVERSIBLE_KINDS` here; `penalty_reversal` imports it) | 05/11 | |
| `app/core/spare_parts.py` | pure state machine (`next_status`, `allowed_actions`, `job_status_after`, `merge_catalogue`, `can_create_facility_role` — also true for admin/national_head on the home franchisee) + `lock_ticket`, `settle_job_status`, `franchisee_has_facility` (replaces the removed `home_parts_handled_by_staff` / `parts_franchisee_for`), `notify_facility` | 12 | the `Awaiting Part` interval for the speed clock is Task 11's `speed.clock_from_events` — not re-implemented here |
| `app/features/spare_parts/` | prefix `/spare-parts` (catalogue + requests) | 12 | |
| `adminWeb/src/pages/franchisees/`, `src/components/franchisees/` | | 08 | staff screen |
| `adminWeb/src/pages/franchise/`, `src/components/franchise/` | `franchiseNav.ts` | 09/13 | portal |
| `mobileapp/src/features/base-location/` | | 14 | |
| `mobileapp/src/features/parts/` | | 15 | |

---

## 4. Task list (development order)

| # | Doc | Task | Layer | Depends on |
|---|---|---|---|---|
| 00 | [00-prerequisites-and-test-harness.md](00-prerequisites-and-test-harness.md) | Merge pincode coordinates; pytest/vitest/jest-expo; CI | all | — |
| 01 | [01-franchisee-schema-and-backfill.md](01-franchisee-schema-and-backfill.md) | Tables, columns, home franchisee backfill, `create_company`, tenancy audit | api | 00 |
| 02 | [02-franchise-roles-and-principal.md](02-franchise-roles-and-principal.md) | 3 roles, feature keys, `Principal.franchisee_id`, guards, scope helpers | api | 01 |
| 03 | [03-franchisee-management-api.md](03-franchisee-management-api.md) | CRUD, range parser, overlap, carve-out, re-stamp, franchisee-admin login | api | 02 |
| 04 | [04-ticket-routing-and-eligibility.md](04-ticket-routing-and-eligibility.md) | Stamp at intake (3 channels), franchisee predicate in all 5 eligibility places, coverage-in-range | api | 03 |
| 05 | [05-technician-ops-move-to-franchisee.md](05-technician-ops-move-to-franchisee.md) | Type, UPI reviewer, penalty reversal, redemption payer, audiences, pool per franchisee | api | 04 |
| 06 | [06-employees.md](06-employees.md) | No payout, no redeem, monthly statement | api | 05 |
| 07 | [07-mobile-forward-compat-release.md](07-mobile-forward-compat-release.md) | Unknown kinds/statuses safe; new kinds & status known; employee hides Redeem | mobile | 06 |
| 08 | [08-console-franchisees-screen.md](08-console-franchisees-screen.md) | Franchisees list/form/range/carve-out preview/admin login | web | 03 |
| 09 | [09-console-franchise-portal.md](09-console-franchise-portal.md) | `/franchise/*` shell + technicians, UPI, redemptions, pool, statements, tickets | web | 05, 06, 08 |
| 10 | [10-travel-allowance-backend.md](10-travel-allowance-backend.md) | Base location, travel rules, `accept_snapshot`, `travel` ledger, force-close | api | 07 |
| 11 | [11-speed-allowance-backend.md](11-speed-allowance-backend.md) | Speed matrix, resolution, clock, pool kinds, cap, reversal | api | 10 |
| 12 | [12-spare-parts-backend.md](12-spare-parts-backend.md) | Catalogue, requests, `Awaiting Part`, events, notifications | api | 07 |
| 13 | [13-console-allowances-and-parts.md](13-console-allowances-and-parts.md) | Travel/speed settings, base map pin, parts catalogue, facility queue, ticket panels | web | 10, 11, 12 |
| 14 | [14-mobile-base-location.md](14-mobile-base-location.md) | Home card, Profile, onboarding step, pincode/GPS/OSM pin | mobile | 10 |
| 15 | [15-mobile-spare-parts-and-allowances.md](15-mobile-spare-parts-and-allowances.md) | Part request, Awaiting Part, travel/speed on job & earnings | mobile | 12, 14 |
| 17 | [17-technician-transfer.md](17-technician-transfer.md) | Admin/NH move a technician between franchisees (open-jobs / balance refusals, coverage re-fit, audit table, bells + push) | api + web | 05, 06, 08, 09 |
| 18 | [18-hand-ticket-to-franchisee.md](18-hand-ticket-to-franchisee.md) | Staff hand an unassigned ticket to another franchisee; `tickets.routing_override` waives the pincode half of eligibility | api + web | 04, 05, 09 |
| 16 | [16-rollout-and-docs.md](16-rollout-and-docs.md) | Prod order, seed/verify, cleanup_db, audit, AGENTS.md updates (also covers 17 and 18 as R9 and R10) | all | all |

**Release gates.** (a) Task 07 is on Play (production track) before Tasks 10–12 are published. (b) Each
migration runs on `RelianceProdDB` (by the owner) before the API that needs it is published.
(c) The PROPOSED copy of a client task is signed off before that task is built.
(b2) Tasks 01–03 are published **together, immediately after** prod is migrated to `5d2a8c6e0b13`: once the five `franchisee_id` columns are NOT NULL the previously deployed API cannot raise tickets, add technicians, close jobs or take redemptions. `franchisee_pincodes` has no writer until Task 03 (hard rule 8) — another reason they ship as one release.
(d) Task 08 does not reach production without Task 09 — once an Admin can create a franchisee-admin login, that person can sign in, and without the portal they would land in the staff shell.
(e) Task 13's console ledger kind labels ship no later than the API writing `travel` / `speed_*` (the console renders an unknown kind as NaN).

---

## 5. Cross-cutting conventions every task follows

1. **Tenancy first.** Every new tenant table: `company_id` FK → companies CASCADE; `uq_<table>_company_id_id`
   when it is a parent; composite FKs `(company_id, x_id)` with covering indexes; a `TENANT_LINKS` entry in
   `api/app/scripts/audit_tenancy.py` per link. A guessed id from another company → **404**.
   **Franchise scoping is a second wall inside the company:** a franchise principal asking for another
   franchisee's technician/ledger/request also gets **404**.
2. **Money** is integer paise; amounts unsigned, direction from `kind`.
3. **Snapshot at accept** for anything that depends on the technician (type, franchisee, travel, speed);
   snapshot at intake (existing `rules_snapshot`) for anything that depends only on the ticket.
4. **Events in the same transaction** as the change they describe (`ticket_events`).
5. **Eligibility predicates live in five places** (a ticket with `routing_override = true`, Task 18, waives only the pincode-coverage half in each) — `jobs/service.pool_query`, `core/coverage.technicians_covering`,
   the guarded UPDATE in `jobs/service.accept`, the assign guard in `tickets/service.assign_technician`, and
   `jobs/ws.py`. A task that changes who may take a job changes all five.
6. **Role vocabularies are hard-coded in several places** — `coverage.payer_role`, `coverage.upi_reviewer`,
   `coverage.users_notified_by` (mirrors `notifications/service._visible`), `scope.visible_pincodes`,
   `visibility.technician_scope`, `adminWeb` `ScopeField`/`roleHasTerritory`. Grep for `national_head` before
   declaring a role change done.
7. **Slices never import each other** (api hard rule 4): shared logic goes in `app/core/`.
8. **Copy** is PROPOSED in the doc and signed off; mobile uses `t()` with keys in all five locale files.
9. **Commit rhythm:** one commit per task (or per screen for client tasks), Conventional Commits,
   `npm run lint && npm run typecheck` (clients) and `pytest api/tests/unit` (api) green first.

---

## 6. Planner defaults the owner may override

- ~~No speed money on force-close (S5).~~ **SETTLED (owner ruling 2026-10-15, R7)** — none; see §6c.
- Facility admin vs operator: both approve and log; admin additionally manages operators (P6).
- Franchisee admin sees its franchisee's tickets read-only (F13).
- A technician whose carve-out would leave zero coverage moves instead (F6).
- Ledger/redemption `franchisee_id` = the technician's franchisee at write time, not the ticket's (3.2).
- Home franchisee keeps today's technician/money rules for existing roles (F8).
- Franchise callers see tickets by **`tickets.franchisee_id` (ownership)**, never through `visible_pincodes` — after a carve-out an assigned ticket keeps its old franchisee while its pincode moves (Task 02).
- **`vendorPricePaise` is withheld from franchise principals** (made nullable on `TicketOut`, nulled for any franchise caller, both clients render `—`). An external franchisee is a separate business and has no reason to see what the vendor is billed; this extends the existing "neither party sees the other's figure" rule. **SETTLED (owner ruling 2026-10-15, R6)** — hidden (null) from every franchise principal.
- Console "last login" for franchise admins is really **last active** (derived from the latest refresh token); the column header says "Last active" (Task 03 → 08).
- Home franchisee: name = the company's name, code `HOME` (reserved per company) (Task 01).
- ~~**Open question (raised by Task 11):** the speed clock starts at ACCEPT.~~ **SETTLED (owner ruling 2026-10-15, R1)** — the clock starts at the LATER of the accept and the confirmed slot start (S3); see §6c.
- ~~**Open question (raised by Task 12):** P4 has no `approved → rejected`.~~ **SETTLED (R2)** — a facility may reject an approved request, with a reason (P4).
- ~~**Open question (raised by Task 12):** home-franchisee part requests handled by company Admin/NH.~~ **SETTLED (R4)** — no Admin/NH fallback; `NO_FACILITY`; Admin/NH may create the home franchisee's facility users (P6, P8).
- Shared login creation (temp password, email, reveal on failure) lives in `app/core/franchise_logins.py` (Task 03 creates it; Task 12 reuses it for facility users).

- **Existing bug found (not in scope):** after a customer answers "not done", a second customer confirmation is impossible, so the job can only be force-closed. Worth its own fix.
- **F7 vs TA6 — SETTLED (owner ruling 2026-10-15, R8):** company staff (Area Manager and above) see **both** the travel amount **and** the speed outcome/amount on any ticket in their scope, **non-home franchisees' tickets included**, so the two behave identically. Still hidden from staff on non-home tickets: the technician's base-location COORDINATES and the franchisee's pool. Facility staff see neither amount; vendors see neither.
- **T1 vs ordering:** Task 06 gates payout on the technician's CURRENT type; Task 10 switches that gate to the type frozen in `accept_snapshot` (by giving `core.employment.job_technician_type` a `snapshot=` keyword the callers pass).

- **Type change rules (Task 05/06) — SETTLED as built (owner ruling 2026-10-15, R5):** freelancer → employee is refused with `TECHNICIAN_HAS_BALANCE` while redeemable money remains (an open redemption doesn't block it; employee-era money is never redeemable) **and** with `TECHNICIAN_HAS_OPEN_JOBS` while the technician holds an open job (stricter than T1, which the accept snapshot already makes safe).
- ~~**Open question (raised by Task 05):** a non-home franchisee with no active franchisee admin.~~ **SETTLED (R3)** — no fallback: the last active franchisee admin of a non-home franchisee cannot be deactivated or removed (409 `FRANCHISEE_LAST_ADMIN`); home is exempt.
- Staff-console changes enabled by Tasks 05/06 are built in **Task 09 §5.10** (technician list/form changes are Task 08).

## 6a. Release-coupling notes discovered while writing the tasks

- **Ledger row titles** (API `earnings/service._title`, mobile and console labels): `travel` → "Travel allowance", `speed_reward` → "Speed reward", `speed_penalty` → "Speed penalty". `_title` today falls back to "Late cancellation penalty" for any unknown kind — Tasks 10/11 must add explicit branches.
- **Earnings arithmetic:** new kinds are FOLDED into the existing figures so old builds' tiles still add up to `net` — `travel` into earned, `speed_reward` into bonuses, `speed_penalty` into penalties — with extra breakdown fields (`travelPaise`, `speedRewardPaise`, `speedPenaltyPaise`) for new builds. `core/ledger.credited()` includes all three. (Tasks 10, 11 implement; Task 07 renders.)
- **X4 nuance:** an unknown LEDGER KIND crashes the installed app (`KIND_STYLE[kind].bg`); an unknown STATUS only misbehaves (falls back to `upcoming`, shows Start job). Gate (a) is therefore: Task 07 live on the Play production track AND ≥90 % of active technicians on that build (Play Console "versions" stats) before Tasks 10/11 publish.
- Task 12 must add `Awaiting Part` to the jobs router's `SEGMENTS["inprogress"]`, or the job appears in no My jobs tab.
- Task 00 adds jest `moduleNameMapper` for the `@/` alias (`"^@/(.*)$": "<rootDir>/src/$1"`).
- Role label "Franchisee Admin" is added to mobile `i18n/serverLabels.ts` (Task 07).

- The console's ledger screen renders an unknown kind as NaN. The console label/format change for `travel`, `speed_reward`, `speed_penalty` must ship **no later than** the API that writes them (Tasks 10/11) — it is pulled into Task 13 but may be split out and shipped with Task 07's window.

## 6b. Contract rulings from the consistency review (2026-10-15)

- **Pincode centres on the wire (Task 10).** `geo` `PincodeOut` (`GET /geo/pincodes`) and Task 05's `FranchisePincodeOut` (`GET /franchise/pincodes`) gain `latitude` / `longitude` (nullable floats), so the console's *Use centre* can move the pin before saving (Task 13). The app (Task 14) needs no lookup — it validates on submit.
- **No `baseLocation` on `SelfRegisterRequest`.** The onboarding step saves through `PUT /technicians/me/base-location` after the account exists (Task 14). Task 10 does not add the field.
- **`PINCODE_OUTSIDE_FRANCHISEE` is always 422** — coverage (Task 04) and base location (Task 10) alike. `PINCODE_HAS_NO_LOCATION` and `BASE_OUTSIDE_INDIA` are 400. Mobile: the generic `errors.code.PINCODE_OUTSIDE_FRANCHISEE` sentence is Task 07's; the base-location screen's own sentence is the screen key `baseLocation.pincode.outside` (Task 14).
- **See but not manage = 403, never 404** (Task 02 §4.2): a staff write on a visible non-home technician — including `PUT /technicians/{id}/base-location` — answers 403 "Managed by {franchisee}" through Task 05's `_load_managed`.
- **Speed catalogue** (`GET /franchise/settings/speed/catalogue`) is `SpeedCatalogueOut { nodes: [...], models: [...] }` (Task 11).
- **Facility users** get `POST /franchise/facility-users/{membershipId}/reissue-password` (Task 12, reusing `core.franchise_logins.reissue_password`), guarded by `require_facility_principal` (a facility admin manages operators). `FacilityUserOut` = `membershipId, userId, fullName, email, phone, role, isActive, createdAt` (Task 12).
- **Part pushes** (`part.approved`, `part.rejected`, `part.issued`) carry `data = {type: 'job', ticketId, code}`; every facility action (all four) and every technician request calls `publish_job_changed` (Task 12).
- **Feature keys are seeded once, by Task 02.** Later migrations (Task 12) do not re-seed them.

## 6c. Owner rulings (settled) — 2026-10-15

The product owner answered the open questions. Each ruling below is applied in the index and in every task doc,
and each changed contract there is marked *(owner ruling 2026-10-15)*. (These **R1–R10** are rulings; Task 16's
**R1–R7** are rollout steps — the two numberings are unrelated.)

| # | Ruling | Where it lands |
|---|---|---|
| R1 | **Speed clock start = the LATER of the accept time and the confirmed slot start** (no slot → accept; a reschedule moves the slot, so the slot in force at completion counts; slot after completion → 0 h; still minus `Awaiting Part`; waits before the clock start are ignored). *Accepted Mon 11:00, slot Thu 10:00–12:00, completed Thu 13:00 → 3 h.* | S3 §2.4, §3.5, §3.7; Tasks 11 (W17, `clock_start`, tests 36–44), 15, 16 |
| R2 | **A facility may cancel an APPROVED part request** (`approved → rejected`, reason required, same reject endpoint; job returns to In Progress once none is requested/approved). | P4; Tasks 12 (D23, `rejected_from`, push `part.rejected_after_approval`), 13, 15 |
| R3 | **Refuse to deactivate/remove the LAST active franchisee admin of a NON-home franchisee**: 409 `FRANCHISEE_LAST_ADMIN`. Home is exempt. No Admin/NH fallback for UPI changes or redemptions on non-home franchisees. Franchisee deactivation is unaffected. | F8, §3.3; Tasks 03, 05, 08, 16 |
| R4 | **Home-franchisee spare parts: no Admin/NH fallback.** A franchisee with no active facility admin/operator → 409 `NO_FACILITY`; the technician API exposes `partsEnabled`; the app hides/disables *Need a spare part* with a line. Company Admin/NH **can create facility users for the HOME franchisee** (`franchisees.manage`). `handles_home_parts` / `home_parts_handled_by_staff` removed. | P6, P8, §3.3, §3.4; Tasks 12, 13, 15, 05 |
| R5 | **SETTLED, as built:** freelancer → employee refused while redeemable money remains (`TECHNICIAN_HAS_BALANCE`) and while open jobs exist (`TECHNICIAN_HAS_OPEN_JOBS`). | T1, §3.3; Tasks 05, 06 |
| R6 | **SETTLED:** `vendorPricePaise` is hidden (null) from every franchise principal. | §6; Task 04 |
| R7 | **SETTLED:** no speed reward/penalty on force-close (S5). | S5; Task 11 |
| R8 | **Company staff (AM and above) see BOTH the travel amount and the speed outcome/amount** on any ticket in their scope, non-home included. Still hidden from staff on non-home tickets: the base-location COORDINATES and the franchisee's pool. Facility staff see neither amount; vendors see neither. | §6; Tasks 09 §5.10, 10, 11, 13 |
| R9 | **Base-location abuse: no approval flow, no cooldown.** A technician may self-set the base; the source and who set it are stored and SHOWN to the franchisee admin (and home managers) on the technician profile and list as a chip (*Pincode / GPS / Map / Set by admin*); the admin can correct it any time; frozen accept snapshots are never restated. | TA7; Tasks 09, 10, 13 |
| R10 | **SETTLED:** no travel estimate on the job offer — travel is shown only after accept. | Task 10 W4; Tasks 14, 15 |

**Minor items still on their written defaults** (not asked, listed in Task 16's open list): `PINCODE_OUTSIDE_FRANCHISEE` is
422 (the owner may prefer 400); facility admin and operator share part powers (P6); a franchisee admin sees its franchisee's
tickets read-only (F13); an employee's force-close payout field is ignored, not refused; reversals land in the month they
are written.

## 6d. Owner rulings — 2026-10-16

| # | Ruling | Where it lands |
|---|---|---|
| R11 | **Yes, a manual technician transfer.** Admin/NH move a technician between franchisees; refused while open jobs or redeemable money remain; coverage re-fitted to the target's range; history stays where it was earned. | Task 17 |
| R12 | **Company staff may hand an unassigned ticket to another franchisee** (reason required; a derived `routing_override` waives the pincode-coverage check only). | Task 18 |
| R13 | **SETTLED:** an external franchisee's freelancers are paid the company's product technician payout — no per-franchisee payout table or percentage. | Tasks 01, 05 as built |
| R14 | **SETTLED:** one franchisee per login. An owner of two franchisees uses two logins. | Task 02 as built |

Open points raised by Tasks 17/18 (written defaults apply): a technician with a NEGATIVE balance may transfer, with a warning (Task 17); an API caller may omit `pincodes` and trim coverage without previewing (Task 17); the source franchisee's admin gets no bell when a ticket leaves (Task 18); hand-over reuses `jobs.assign` plus the Area Manager floor rather than a new key, and external targets need no higher rank (Task 18).

## 7. Copy sign-off checklist

Each client task has a **PROPOSED copy** section. Tick when signed off:

- [ ] 08 Franchisees screen
- [ ] 09 Franchise portal
- [ ] 13 Allowances, parts catalogue, facility queue
- [ ] 07 Mobile new ledger kinds / status labels / employee earnings
- [ ] 14 Mobile base location
- [ ] 15 Mobile spare-part request and allowance display
- [ ] 17 Technician transfer dialog and push
- [ ] 18 Hand-to-franchisee dialog
