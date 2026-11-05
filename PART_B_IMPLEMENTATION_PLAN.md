# Part B — Detailed Implementation Plan (Backend · Frontend · Mobile)

Companion to `new_updates_implementation.md`. Part A is done; this covers Part B only.
**Epic 5 (technician bank accounts) is dropped from scope** — UPI stays the only payout account.
Epic numbers are kept as in the original breakdown so the two files stay cross-referenceable.

Legend: **BE** = `api/` (FastAPI) · **FE** = `adminWeb/` (React console + vendor/franchise portals) · **MOB** = `mobileapp/` (Expo).

Cross-cutting rules for every task: money in paise integers; balances summed live, never stored;
every tenant table has `company_id` and composite FKs; a guessed id returns 404; every new table gets an
Alembic migration tested as upgrade → downgrade → upgrade, applied to **both** RelianceDB and RelianceProdDB
before the code that needs it ships; run `python -m app.scripts.audit_tenancy` after each schema change;
every list ships loading / empty / error states; every foreign key gets a covering index; UNIQUEs on
soft-deleted tables are partial on `deleted_at IS NULL`. Mobile strings go in `en.json` plus the four translations.

---

## Build order

| Step | Work | Why here |
|---|---|---|
| 1 | Epic 1.1 → 1.2 → 1.3 | Money spine; everything else in Epic 1 reads it |
| 2 | Epic 1.4, 1.5, 1.6, 1.7 | Needs documents to exist |
| 3 | Epic 3 | Same ledger/redemption code as Epic 1; do after 1.3 to avoid conflicts |
| 4 | Epic 6, Epic 2, Epic 7 | Independent, small to medium |
| 5 | Epic 4 | Independent but needs a new mobile binary release |

---

## EPIC 1 · Money & Documents — Transactions Dashboard (#1 #2 #3 #4 #18 #21)

Goal: one append-only layer of numbered internal documents over the existing ledgers, plus the new
company↔franchisee settlement flow, a dashboard, statements and invoice email. No GST/tax engine.

### 1.1 Document + proof data model

**BE**
- New `api/app/models/transaction_document.py`, table `transaction_documents`: `id`, `company_id`, `doc_type`
  (CHECK in `sales_invoice, receipt, payment, debit_note, credit_note, purchase_note`), `number`
  (unique per `(company_id, doc_type, number)`), `issuer_party_kind` / `issuer_party_id`,
  `counter_party_kind` / `counter_party_id` (kinds: `company`, `vendor`, `franchisee`, `platform`),
  `amount_paise` (CHECK > 0), `issued_at`, `source_kind` + `source_id` (which ledger row caused it:
  `vendor_credit_entry`, `company_credit_entry`, `settlement_entry`, `ledger_entry`, `ticket`),
  `note`, `proof_blob_name` (nullable), `proof_reference` (UTR / cheque no, nullable), `related_document_id`
  (a credit note points at the invoice it offsets; composite FK on `(company_id, related_document_id)`).
- Append-only: no UPDATE/DELETE path in the service; a correction is a new reversing document. Unique
  `(company_id, source_kind, source_id, doc_type)` makes generation idempotent so a retried closure cannot
  issue two invoices.
- Extend `core/sequences.py` with one counter per `(company_id, doc_type)`; prefixes `INV`, `RCT`, `PAY`, `DN`, `CN`, `PN`.
- Models registered in `models/__init__.py`; migration with covering indexes on every FK and on
  `(company_id, issued_at)` and `(company_id, counter_party_kind, counter_party_id, issued_at)`.
- Proof upload reuses `features/uploads` and the `_proof_ok` / blob-name pattern from `redemptions/service.py`.

**FE** — none yet (consumed by 1.5).
**MOB** — none.

### 1.2 Company ↔ franchisee settlement ledger (#21) — net-new

**BE**
- New `models/franchise_settlement.py`, table `franchise_settlement_entries`: `company_id`, `franchisee_id`,
  `direction` (`company_to_franchisee` | `franchisee_to_company`), `amount_paise`, `reason`
  (e.g. share, lease, advance, adjustment), `proof_blob_name` **NOT NULL**, `utr` (optional),
  `recorded_by_user_id/label`, `confirmed_at` + `confirmed_by` (the receiving side confirms — mirrors the
  redemption rule that only the receiver can say money arrived), `declined_at` + reason.
  Balance = sum of confirmed entries by direction, summed live.
- New `features/franchise_settlements/` (router, schemas, service). Staff side (Admin / National Head only, via
  `core/franchise_money.py` helpers): record a transfer to or from any franchisee, list, detail. Franchise
  portal side (franchisee admin, own franchisee only — others 404): list own entries, **confirm** received,
  **decline** with reason, view balance.
- Home franchisee is excluded (it is the company itself): 409 `HOME_FRANCHISEE_NO_SETTLEMENT`.
- Writes a document through 1.3 (payment doc when company pays out; receipt when it receives).
- Update the AGENTS.md note that says company↔franchisee money is "not in this product".

**FE**
- Console: new page `pages/franchisees/FranchiseeSettlementsPage.tsx` (or a tab on the franchisee detail) with a
  `DataTable`, a "Record transfer" dialog (amount, direction, reason, proof via existing `PaymentProofForm.tsx`).
- Franchise portal: new page `pages/franchise/FranchiseSettlementsPage.tsx`, nav entry in `franchiseNav.ts` /
  `franchiseRouteMeta.ts`; rows awaiting the franchisee's confirmation get Confirm / Decline buttons.
- Services + hooks mirroring `vendorCredit` (`services/`, `hooks/`).

**MOB** — none (technicians are not parties).

### 1.3 Document generation hooks on existing flows (#2)

**BE** — a single `core/documents.py` with `issue(db, ...)` called **inside the same transaction** as the change it
documents (a document that can disagree with its ledger is worse than none):
- `core/vendor_credits.charge_closure` → **Sales Invoice** (vendor billed at closure, amount = stamped
  `vendor_price_paise`) and a **Debit Note** on the vendor account.
- `core/vendor_credits.apply_payment` (company confirms a vendor payment) → **Receipt**.
- `core/credits` recharge confirmation (superadmin confirms a company recharge) → **Purchase Note** (company
  purchased credits from the platform) + **Receipt** from the platform.
- `core/penalty_reversal` / ledger `reversal` → **Credit Note** referencing the original document where one exists.
- Settlement entry confirmed (1.2) → **Payment** / **Receipt** pair.
- Technician redemption confirmed → **Payment** document (company/franchisee paid technician). Decide in review
  whether technician payments should appear at all; default plan: yes, party kind `technician`.
- Backfill script `app/scripts/backfill_documents.py` (idempotent via the unique source key) for history already
  in the ledgers; run on dev first, then production.
- Unit tests: idempotency, rollback leaves no document, amounts equal the source row.

**FE / MOB** — none.

### 1.4 Optional extra amount at raise (#18) [dep 1.1, 1.3]

**BE**
- `tickets`: add `extra_amount_paise` (nullable, CHECK ≥ 0) and `extra_amount_note` (e.g. "part charge"). Stamped
  at intake like the prices; never editable afterwards except through a staff correction that writes a credit note.
- `create_ticket` / schemas: accept the optional fields from the **vendor** only; the technician job shapes
  (`JobOfferOut` / `JobOut`) must **not** carry it (neither party sees the other's figure).
- `core/vendor_credits.quote` / `assert_within_limit` must include the extra amount in the reservation so the
  credit-line check stays honest; `charge_closure` bills price + extra and issues the Sales Invoice with both lines
  and a Debit Note for the extra.
- A cancellation bills nothing (falls out of the model). Excel importer: add an optional `ExtraAmount` column
  (`tickets/import_service.py`) with a dry-run line.

**FE**
- `components/tickets/ManualEntryForm.tsx`: optional "Extra charge (₹)" + "What is it for" fields in the vendor
  form, Zod rule in the ticket schema; hide in staff views that must not see vendor money per role.
- Ticket detail: show the extra charge to vendor and billing staff only.
- Import template/help text updated.

**MOB** — none (must stay out of job payloads).

### 1.5 Transactions Dashboard (#1)

**BE**
- New `features/transactions/` — `GET /transactions` (filters: `from`, `to` IST dates, `docType`, `partyKind`,
  `partyId`, `vendorId`, `franchiseeId`; keyset pagination), `GET /transactions/summary` (totals per type and
  period), `GET /transactions/{id}` (with proof URL). Scope: superadmin → all companies (optional `companyId`
  filter); Admin/NH → own company; vendor → own documents only; franchisee admin → own franchisee only;
  every other role → 403.
- Proof URLs are time-limited signed links, never raw blob names (same as `_proof_url`).

**FE**
- `superadminNav.ts`: add "Transactions" (and make it the superadmin landing instead of `/companies`; update
  `RequireSuperadmin` redirect and `SuperadminSidebar`).
- `pages/superadmin/TransactionsPage.tsx`: `KpiRow` totals by type, `DashboardFilterBar` date range, party /
  vendor / type filters in the `Toolbar`, `DataTable` with open-document drawer (number, parties, amount, source
  link, proof preview).
- Company console: same page under the Finance nav for Admin/NH, scoped. Vendor portal: "My statements & documents".
  Franchise portal: "Documents". Share one `TransactionsTable` component; scope comes from the session.
- Date filter state in the URL (as Part A's vendor filter does).

**MOB** — none.

### 1.6 Debit / credit statements (#4)

**BE**
- `core/account_statements.py` (pattern of `core/statements.py`): per party per date range, opening balance,
  each document as debit or credit, running balance, closing balance. Endpoints
  `GET /transactions/statement?partyKind&partyId&from&to` and `/statement.csv`, same scope rules as 1.5.
- A superadmin "all companies" statement = one block per company in a single CSV; reuse `csv_safe` against
  formula injection.

**FE** — "Statement" tab on the Transactions page and on vendor/franchisee detail: party picker, date range,
on-screen running-balance table, Download CSV (reuse `StatementMonthPicker` patterns / `DownloadStatementCard`).
**MOB** — none.

### 1.7 Auto-email invoices to admins (#3)

**BE**
- Templates `emails/templates/document_issued.html` and `statement_monthly.html`, wired in `emails/render.py`.
- Send on generation: after commit, enqueue an email to the company's active Admin users (and the vendor's
  contact if the doc is vendor-facing); record `emailed_at` / `email_status` on the document so a failure is
  visible and retryable (the app already reports email failure without failing the request).
- Monthly batch via a sweep in `app/core/scheduler.py` (first day of month, IST): per company a statement
  email to each Admin. Dedup marker per (company, month).
- Superadmin "Re-send / broadcast" endpoint: re-sends a chosen range's documents to each company's admins.
- ACS rate limits: send sequentially with a small delay; dev uses the existing echo/fallback when ACS is unset.

**FE** — superadmin Transactions page: "Email to admins" action (range + companies), per-row email status
badge and "Resend". Settings toggle in Rules Config: per-document auto-email on/off (company_rules column).
**MOB** — none.

---

## EPIC 2 · Geography checkbox tree — Region → State → District → Pincode (#8)

**BE**
- `features/geo`: add `GET /geo/tree?regionId=` returning states → districts with **counts only**, and
  `GET /geo/districts/{id}/pincodes` for lazy leaf loading (19,496 pincodes cannot ship to the browser). Add
  `GET /geo/states/{id}/pincodes` for "select whole state".
- Franchise portal equivalent bounded by the franchisee's territory (`/franchise/geo/...`), and honour the
  Area Manager state limit — the server rejects pincodes outside it as today.
- Selection model: the client sends **selected nodes** (`{states:[], districts:[], pincodes:[]}`) and the server
  expands them to pincodes inside the existing 'expand then validate' path (`core/pincode_ranges.py` pattern),
  so a whole-state tick does not post 2,000 strings. Keep the old `pincodes: string[]` accepted for installed apps.
- Reuse existing validation: `PINCODE_OUTSIDE_FRANCHISEE`, AM-state check, franchisee pincode-taken refusal.

**FE**
- New `components/ui/geo-tree.tsx`: tri-state checkboxes (checked / indeterminate / unchecked), lazy-expand,
  search box, "Select all in <node>", selected summary chips with remove, virtualised list for districts with
  many pincodes. Built on `ui/checkbox`.
- Replace the region `Select` + pincode `MultiSelect` in `components/technicians/CoverageFields.tsx` (the
  prop contract stays so `TechnicianFormDialog`, `TechnicianInviteDialog`, franchisee form and the franchise
  portal pick it up unchanged); keep `limitTo` and `hasOtherFranchisees` behaviour.
- Tests: indeterminate propagation, select-all then untick one, franchisee-limited tree.

**MOB**
- Technician self-registration coverage (`features/onboarding`) is a pincode picker today; **optional** follow-up
  to give it the same tree. Not required by the ask (the ask is the console); confirm before building.

---

## EPIC 3 · Per-freelancer rules + minimum redeemable + holding amount (#9 #10)

**BE**
- New `models/technician_rules.py`, table `technician_rules` (one row per technician, composite FK on
  `(company_id, technician_id)`): nullable overrides for the rule groups — payout (`payout_percent` or fixed
  override), `bonus_*`, cancellation penalty bands, speed reward/penalty hours and amounts, travel free-km /
  rate / cap — plus `min_redeemable_paise` (nullable) and `holding_amount_paise` (default 0, CHECK ≥ 0).
  Null = inherit. Migration + tenancy audit.
- `core/rules.py`: add the technician tier to resolution:
  `DEFAULTS → company → node chain → franchisee×type → technician`. **Important:** per ticket rules are frozen
  at intake (`rules_snapshot`) and technician-dependent terms at accept (`accept_snapshot`). Technician
  overrides therefore resolve **at accept time** and are written into `accept_snapshot`; they never restate a
  job already accepted. Read via `core.accept_snapshot`, never a bare `[]`.
- `core/ledger.py`, `core/speed_rules.py`, `core/travel_rules.py`, payout/bonus/penalty writers: read the
  frozen accept snapshot values. `cancel_penalty_cap_paise` stays company-only (monthly cap across jobs).
- Validation: run `validate_resolved` on the technician-resolved set; a write that breaks an invariant is 422.
- Redemption (`features/redemptions/service.py`, `core/ledger.redeemable_balance`):
  `redeemable = max(0, balance − holding)`, then capped at ₹1,00,000. A request below the technician's
  minimum (technician override → franchisee/company default) is refused with 409 `BELOW_MIN_REDEEMABLE`
  carrying the minimum. Company default minimum is a new `company_rules` column (Rules Config).
  `summary()` returns `holdingPaise`, `minRedeemablePaise`, `redeemablePaise`.
- Holding workflow: `POST/PATCH /technicians/{id}/holding` (set amount + reason), `DELETE` to release; each change
  writes an audit row (`technician_holding_events`: actor, old, new, reason). Permission: the technician's
  franchisee admin; for the home franchisee, Admin / NH. Another franchisee's technician = 404.
  Holding is a reservation, not a ledger entry — it never moves money.
- `GET/PUT /technicians/{id}/rules`. Authorisation = same as editing the technician (franchisee admin, or
  Admin/NH for home). Technician cannot edit their own.
- Employees: per-job payout rules stay inapplicable; their overrides cover bonus/penalty/speed/travel only.
- Tests: resolution order, snapshot immunity (change override after accept → job unchanged), threshold and
  holding arithmetic, holding larger than balance → redeemable 0.

**FE**
- `components/technicians/TechnicianRulesPanel.tsx` on the technician detail: grouped sections (Payout, Bonus,
  Penalty, Speed, Travel) each showing the **inherited value and its source** (as Rules Config's scope selector
  already does), an "Override" toggle per field, reset-to-inherit, and a banner "applies to jobs accepted after
  saving".
- "Redemption controls" card: minimum redeemable input and a Holding amount with Set / Release dialog (reason
  required), plus holding history list. Zod schemas in `technicianSchema.ts`.
- Rules Config: company-default minimum redeemable field.
- Redemption pages/QR dialogs: show the technician's holding where a payer decides what to pay.

**MOB**
- `features/redeem`: show "Available to redeem" (net of holding), the minimum, and a clear note when below it;
  disable "Redeem" with the reason, not silently. Handle `BELOW_MIN_REDEEMABLE` in `i18n/errorText.ts`.
- `features/earnings`: a "On hold ₹X" line when holding > 0, so the number does not look wrong.
- Strings in `en.json` + hi/te/kn/ta; run `npm run i18n:check`.
- Does not need a new native binary; old builds still work because they ignore the new fields and the server
  enforces the rules.

---

## EPIC 4 · Technician live location — active job only (#12)

**BE**
- New `models/technician_location.py`: `technician_locations` (`company_id`, `technician_id`, `ticket_id`,
  `latitude`, `longitude`, `accuracy_m`, `recorded_at`, `received_at`) with coordinate CHECKs (as base location),
  composite FKs, index `(ticket_id, recorded_at desc)`. Keep only **latest per technician** in a small table plus a
  short rolling history (e.g. 24 h) pruned by a sweep — nothing is kept longer than needed (location is personal data).
- `POST /jobs/{id}/location` (technician only, own accepted job, status in the active set: accepted → travelling →
  In Progress / Awaiting Part): rejects with 409 outside that window, rate-limited (≥ 15 s apart server-side).
  Stored location is deleted/archived when the job leaves the active set.
- Read: `GET /tickets/{id}/technician-location` and `GET /technicians/locations?ticketIds=…` — returns the latest
  point only while the job is active; otherwise `null` (never a stale pin). Scope: superadmin; company staff within
  territory; franchisee admin for own franchisee; vendor only for tickets it raised (and only the point, no
  technician phone). Real-time via the existing `core/realtime.py` / `jobs/ws.py` so the map updates without polling;
  fall back to 15–30 s polling.
- Privacy: no base-location coordinates are exposed (existing rule); consent copy recorded in the app; document
  retention in AGENTS.md. Kill switch: `company_rules.live_location_enabled` (default on).

**FE**
- New `components/tickets/TechnicianLiveMap.tsx` using the lazy Leaflet chunk behind `BaseLocationMap`: pin for the
  technician, pin for the customer address (ticket lat/long or pincode centre), "last updated N s ago", accuracy
  circle, offline notice when no update > 2 min.
- Ticket detail → "Live location" card (staff, franchise portal read-only, vendor portal). Optional console page
  "Live technicians" listing active jobs on one map for Admin/franchisee.
- Handles empty (job not active), loading, error states.

**MOB** (needs a new production binary — `expo-location` is already installed but background permission is not)
- `features/jobs/hooks/useLiveLocation.ts`: while the job is active **and the app is foregrounded**, call
  `Location.watchPositionAsync` (balanced accuracy, ~20 s / 25 m), POST to `/jobs/:id/location`, stop on job end,
  cancel, sign-out or permission revoke. Foreground-only keeps Play review simple; background tracking is a
  separate decision (needs `ACCESS_BACKGROUND_LOCATION` justification) — flag, do not build unprompted.
- Permission prompt copy via `t()` explaining it is shared with the company while the job is active only; a visible
  "Sharing location" indicator on job detail.
- Failure handling: queue the latest point only, drop on network error, no retry storm; pause on low battery option optional.
- Tests for the hook with mocked `expo-location`.

---

## EPIC 6 · Spare-parts delivery address per technician (#11)

**BE**
- `technician_profiles`: add `parts_address_line`, `parts_city`, `parts_pincode` (6-digit shape + must exist in the
  master, as ticket pincodes do), `parts_landmark`, `parts_contact_phone`, `parts_address_set_by_user_id/at`.
  CHECK: pincode shape; all-or-nothing for the required lines. Default (unset) resolves to the technician's base
  pincode / registered address in code — **copied at request time**, not linked (same rule as the base location).
- `SparePartRequest`: stamp `delivery_address` (JSONB snapshot: lines, pincode, contact phone) at request creation
  so a later change never reroutes a part already in flight. Migration for both tables; backfill none (null =
  "use the base at the time").
- `spare_parts/service.py`: include the snapshot in `PartRequestOut` for the facility queue; refuse to create a
  request when no address and no base exists? Decide: **don't refuse** — facility sees "no address on file".
- Endpoints: technician `PATCH /me/parts-address`; franchisee admin / Admin / NH `PATCH /technicians/{id}/parts-address`
  (same authority as editing the technician).
- Tests: snapshot immutability, other-franchisee 404, pincode validation.

**FE**
- `TechnicianFormDialog.tsx` + technician detail: "Parts delivery address" section using `AddressFields` (with the
  pincode check and, after Epic 7, the local-area dropdown); display as read-only block when set by the technician.
- Facility queue (`pages/franchise/FacilityQueuePage.tsx`, `PartRequestPage.tsx`): show the delivery address with a
  copy button, and print-friendly label view.

**MOB**
- Profile → new "Parts delivery address" screen under `features/profile` (form with pincode check, "Use my base
  location" shortcut). Show the chosen address on the "Need a spare part" confirmation (`features/parts`) with an
  edit link before submit. i18n in all five languages.

---

## EPIC 7 · Local-area / post-office dropdown (#17)

**BE**
- New global master (no `company_id`, like geography): `post_offices` (`id`, `pincode` FK, `name`, `branch_type`,
  `delivery_status`, `district_id`, `source`, `is_active`); unique `(pincode, name)`; index on `pincode`.
- Importer `app/scripts/import_post_offices.py` (and optionally a superadmin sheet import on the Geography page,
  same pattern as the pincode import: dry-run report, template download). Data source: India Post PIN directory
  (data.gov.in) — **needs a decision on who supplies the file**; keep a `source` column so sheet rows survive
  re-imports like `pincodes.source`.
- `GET /geo/pincodes/{code}/post-offices` (any signed-in principal; returns names only). Tickets: add nullable
  `locality` (string) stamped at intake; validated as optional — a locality not in the list is allowed (free text
  fallback, since the master is never complete). Excel importer: optional `Locality` column.
- Production must be loaded the same way as dev before publishing, as with pincode coordinates.

**FE**
- `components/shared/AddressFields.tsx`: after a valid pincode, fetch post offices and show a "Local area"
  combobox (with "Other — type it" fallback); city auto-follow already exists from Part A — keep it intact. Clear
  the selection when the pincode changes.
- Ticket detail shows the locality. Reused by the Epic 6 address form. Optional 7.4: show the area names under the
  pincode chips in technician coverage.
- Superadmin Geography page: "Post offices" import dialog if the sheet route is chosen.

**MOB**
- None required (customer address is entered by vendors on the web). If job detail should show the locality,
  add `locality` to the post-accept `JobOut` after masking rules (it is part of the address, so masked before accept).

---

## Decisions (answered 2026-10-30)

1. Epic 7 post-office dataset: **the client will supply it.**
2. Technician redemptions create `payment` documents: **yes** (built).
3. Document numbering per company per type, **no tax fields** (built: `RGT-INV-0001`).
4. Holding amount shows as a read-only "On hold" line on Earnings: **yes** (Epic 3).
5. Live location: **foreground only.**
6. Mobile onboarding coverage picker also gets the geography tree: **yes** (Epic 2).

## Epic 1 status (backend complete; frontend per the notes)

| Task | Backend | Frontend |
|---|---|---|
| 1.1 documents model | done | - |
| 1.2 franchise settlements | done, smoke-tested on dev | built, not yet exercised live |
| 1.3 document hooks + backfill | done; dev backfilled (452 documents) | - |
| 1.4 extra charge at raise | done | see hand-off |
| 1.5 Transactions dashboard | done | see hand-off |
| 1.6 statements | done | see hand-off |
| 1.7 email to Admins | done (batched sweep + re-queue) | see hand-off |

Deferred inside Epic 1 (not built, say so before relying on them): per-company auto-email switch, monthly
statement email, `ExtraAmount` column in the Excel importer, bells for settlements.
