# InstallFlow — Client Change Request: Segregation & Implementation Breakdown

## Context

The client (InstallFlow / "Reliance GreenTech" — a multi-tenant field-service platform)
requested **22 changes** across the super-admin, company-staff, vendor, franchise, and
technician surfaces. The user (acting as senior engineer/architect) wants them **segregated
into two groups inside ONE deliverable file**, nothing omitted:

- **Part A** — small UI changes + simple backend tasks → a flat checklist.
- **Part B** — major flows, heavy implementation, cash-transaction flows, business logic,
  complex backend → an **indented dependency tree** (epic → task → leaf), with order & deps.

This plan file holds the full deliverable content. **On approval it is written to
`installflow/RequirementDocs/CHANGE_REQUEST_BREAKDOWN.md`** (a docs/requirements folder that
already exists) — no code is changed by this task; it is the implementation roadmap only.

### Confirmed decisions (from the user)
1. **Output** — one markdown file: Part A flat checklist, Part B indented tree.
2. **Accounting** — a unified **Transactions Dashboard** for sales-invoice-no / receipt /
   payment / debit note / credit note / purchase note across **vendors + admins + franchisees**;
   **internal documents only** (no GST/tax engine); flow design delegated to me. Merges asks
   #1/#2/#3/#4/#18/#21 into one "Money & Documents" epic.
3. **Live location** — track + show **only during an active/accepted job**.
4. **Bank account** — bank (name/acct/IFSC) **alongside** UPI, technician-owned.
5. **#18 extra amount** — vendor optionally adds a part charge at raise → **debits vendor
   account** → Debit Note; single straightforward flow, refine later.
6. **Per-freelancer** — **full set**: per-technician overrides for payout/bonus/penalty/
   speed/travel + minimum redeemable threshold + manual holding (reserved) amount.
7. **#22 reminder** — fire 30 min before **`slot_end`**.

### Architecture facts grounding this plan (from exploration)
- Apps at `installflow/installflow/`: `adminWeb/` (React 19 + Vite + Tailwind v4 + shadcn),
  `api/` (FastAPI + PostgreSQL + SQLAlchemy async; **money = paise integers**; multi-tenant by
  `company_id`, Alembic migrations), `mobileapp/` (Expo).
- Money today = 4 append-only ledgers — technician pool/payouts (`api/app/models/ledger.py`),
  company↔platform credits (`credits.py`), vendor↔company credit line (`vendor_credits.py`),
  technician redemptions (`redemption.py`). **No invoices/receipts/notes/statements exist.**
- Human-readable numbers minted in `api/app/core/sequences.py`.
- **No super-admin dashboard** today (superadmin lands on `/companies`).
- **Company↔franchisee money is explicitly NOT modeled** (code comment) — net-new for Epic 1.
- Reusable UI: `DataTable`+`Toolbar` filters, `DashboardFilterBar` (date range + cascading geo),
  `ManualEntryForm` (raise ticket, cascading selects), `CoverageFields` (pincode picker),
  importer pattern (`tickets/import_service.py`, serial/geo), `BaseLocationMap` (Leaflet),
  `KpiRow`/`AttentionCards`, `AddressFields`, image/file upload hooks.
- Time-based jobs run on a **sweep ticker** (`api/app/main.py` lifespan → `tickets/sweeps.py`).
  Notifications: push (`pywebpush`) + WhatsApp (`api/app/integrations/whatsapp.py`) + ACS email
  (`api/app/integrations/acs_email.py`, templates in `api/app/emails/templates/`).

---

## Coverage matrix (all 22 asks → where each lands — nothing dropped)

| # | Ask | Part | Item |
|---|-----|------|------|
| 1 | Super-admin date-wise account filter | B | Epic 1.5 |
| 2 | Accounts docs: invoice/receipt/payment/debit/credit/purchase note | B | Epic 1.1–1.3 |
| 3 | Invoice auto-email to all admins | B | Epic 1.7 |
| 4 | Debit/credit statements for all companies | B | Epic 1.6 |
| 5 | Vendor-wise filter (company admin dashboard + tickets list) | A | A1 |
| 6 | High-priority flag for tickets | A | A2 |
| 7 | Technician bank accounts (name/acct/IFSC) alongside UPI | B | Epic 5 |
| 8 | Geography Region→State→District→Pincode checkbox tree | B | Epic 2 |
| 9 | Per-freelancer individual rules (no universal) | B | Epic 3 |
| 10 | Min redeemable threshold + manual holding amount per technician | B | Epic 3 |
| 11 | Spare-parts delivery address per freelancer/technician | B | Epic 6 |
| 12 | Technician live location (active-job only) for SA/admin/franchisee/vendor | B | Epic 4 |
| 13 | Brand dropdown in vendor raise-ticket | A | A3 |
| 14 | Reorder raise-ticket: Vendor→Brand→Category→Subcategory→Serial | A | A4 |
| 15 | "Uninstall" service type | A | A5 |
| 16 | Alternate number in raise-ticket | A | A6 |
| 17 | Local-area / post-office dropdown for pincode | B | Epic 7 |
| 18 | Manual optional extra amount at raise (debits vendor) | B | Epic 1.4 |
| 19 | Online/offline + platform master (visible to all) | A | A7 |
| 20 | Bulk import products | A | A8 |
| 21 | Transparent vendor→admin→franchisee cash flow with proofs | B | Epic 1.2 |
| 22 | Tech reminder 30 min before slot_end if serial photo not uploaded | A | A9 |

---

## PART A — Small UI / simple backend (flat checklist)

> Each item is self-contained, reuses existing patterns, and ships independently.

- [ ] **A1 · #5 Vendor-wise filter**
  - Tickets list: add a Vendor `TypedFilterDef` (combobox) to `adminWeb/src/components/tickets/TicketTable.tsx`; add `vendor_id` query param to `api/app/features/tickets/router.py` + `service.py` (server-mode already paginates).
  - Dashboard: add a Vendor selector to `adminWeb/src/components/dashboard/DashboardFilterBar.tsx`, thread via URL query in `pages/dashboard/DashboardPage.tsx` → `hooks/useDashboard.ts` → `services/dashboard.ts`; backend dashboard aggregation accepts `vendor_id`.
  - Reuse `ui/combobox.tsx` + vendor list service. **Done when** both lists filter by vendor and the URL is shareable.

- [ ] **A2 · #6 High-priority ticket flag**
  - Add `is_high_priority` boolean to `api/app/models/ticket.py` + Alembic migration; expose in `TicketOut` and accept in create/update `schemas.py`.
  - UI: checkbox in `ManualEntryForm.tsx` (vendor at raise) + staff edit; priority badge + a High-priority filter pill and sort in `TicketTable.tsx`.
  - No SLA/routing effect (visual + filter/sort only). **Done when** flag persists, shows as a badge, filters & sorts.

- [ ] **A3 · #13 Brand dropdown in raise-ticket**
  - Add an explicit Brand `Select` in `ManualEntryForm.tsx` sourced from the vendor's approved brands (`VendorBrand`). Feeds A4 ordering (brand filters the model list).

- [ ] **A4 · #14 Reorder raise-ticket cascade → Vendor → Brand → Category → Subcategory → Serial**
  - Reorder the cascade in `ManualEntryForm.tsx`; brand (A3) becomes an upfront selector that scopes category/model; keep the category drill-down and **serial autofill preserved**; model still chosen (filtered by brand+subcategory). Adjust `useAutoSelectSingle` wiring. (UI-heavy; no schema change.)

- [ ] **A5 · #15 "Uninstall" service type**
  - Add `"Uninstall"` to `api/app/core/service_types.py`; update the CHECK constraints on `Ticket.service_type` and `ProductModel.service_types` + Alembic migration. Selectors read the catalog, so it appears automatically in ticket + product-model forms.

- [ ] **A6 · #16 Alternate number in raise-ticket**
  - Add nullable `customer_alt_phone` (E.164) to `api/app/models/ticket.py` + migration + schemas; optional field beside `customer_phone` in `ManualEntryForm.tsx`, same validation.

- [ ] **A7 · #19 Online/offline + platform master**
  - New `purchase_platforms` master (company-scoped, admin-managed, readable by all roles) + CRUD; add `purchase_mode` (online/offline) + nullable `purchase_platform_id` to `tickets` + migration.
  - UI at raise (`ManualEntryForm.tsx`): online/offline radio + platform select (shown when online) with an inline "add platform" for admins; shown read-only on ticket detail for everyone. (Small, but introduces one master table.)

- [ ] **A8 · #20 Bulk import products**
  - New `api/app/features/masters/import_service.py` mirroring `tickets/import_service.py` (two-pass dry-run→confirm, `openpyxl`); columns = category path, brand, name, service types, capacity, warranty, pricing, parameters; respects approval (vendor import → pending, staff → approved).
  - UI: `adminWeb/src/components/masters/ProductImportDialog.tsx` reusing `useFilePicker`, preview tiles, `RejectsTable`; add button on the products page.

- [ ] **A9 · #22 Technician "complete task" reminder**
  - New sweep in `api/app/features/tickets/sweeps.py` (registered on the existing ticker): select tickets in Assigned/In Progress where `slot_end - 30min ≤ now < slot_end` **and** no serial-number proof photo on `ticket_proofs`; fire once (dedupe via a `ticket_events` marker or `serial_reminder_sent_at` column + migration).
  - Channel: push (`pywebpush`) + WhatsApp. Mobile handles the push → deep-links to the job's proof-capture (serial photo) screen. (Reuses sweep + notification infra; focused backend task.)

---

## PART B — Major flows / cash / business logic (dependency tree)

> `└─`/`├─` = child task; `[dep …]` = prerequisite. Build Epic 1 first (spine); Epics 2–7 are
> largely independent of each other.

```
EPIC 1 · Money & Documents — Transactions Dashboard   (#1 #2 #3 #4 #18 #21)
│   Goal: one transparent, append-only transaction + document layer over the existing ledgers,
│   covering vendor↔admin and the NEW admin↔franchisee flow, with payment proofs, surfaced on a
│   dashboard and as statements, with auto-email. Internal documents only (no GST).
│
├─ 1.1 Document + proof data model
│   ├─ 1.1a transaction_documents (type ∈ {sales_invoice, receipt, payment, debit_note,
│   │        credit_note, purchase_note}, number, issuer_party, counter_party, amount_paise,
│   │        status, source_ledger_ref, company_id) — new model in api/app/models/
│   ├─ 1.1b per-type sequence codes — extend api/app/core/sequences.py
│   └─ 1.1c payment-proof attachment (blob url + reference) — reuse uploads + Azure Blob
│
├─ 1.2 Company↔franchisee settlement ledger  [NET-NEW — not modeled today]   (#21)   [dep 1.1]
│   ├─ 1.2a append-only ledger model (company→franchisee debit/credit entries) — api/app/models/
│   ├─ 1.2b service + endpoints (staff side + franchise portal) — api/app/features/...
│   └─ 1.2c proof REQUIRED on every transfer (ties 1.1c)
│
├─ 1.3 Document generation hooks on existing money flows   (#2)   [dep 1.1]
│   ├─ 1.3a vendor charged at ticket closure → Sales Invoice (+ Debit Note) — core/vendor_credits.py
│   ├─ 1.3b settlement/payment received → Receipt / Payment doc — vendor_credits, credits, redemption
│   ├─ 1.3c ledger reversal → Credit Note — core/ledger.py
│   └─ 1.3d company recharge / purchase → Purchase Note — core/credits.py
│
├─ 1.4 Manual optional extra amount at raise   (#18)   [dep 1.1, 1.3a]
│   └─ optional vendor "extra part charge" field in ManualEntryForm → debits vendor account
│      (vendor_credit entry) → Debit Note; one straightforward flow (refine later)
│
├─ 1.5 Transactions Dashboard UI   (#1 super-admin date-wise + per-party)   [dep 1.1–1.3]
│   ├─ 1.5a NEW super-admin dashboard shell + nav entry — superadmin/superadminNav.ts, SuperadminShell
│   ├─ 1.5b transactions list (DataTable) + date-range (DashboardFilterBar) + party/vendor/type filters
│   ├─ 1.5c scoped views: company admin = own; vendor & franchisee = their own (portal/franchise)
│   └─ 1.5d KPI totals by type/period — reuse KpiRow
│
├─ 1.6 Debit/Credit statements   (#4)   [dep 1.1–1.3]
│   ├─ 1.6a running-balance statement per party per period — api/app/core/statements.py pattern
│   └─ 1.6b on-screen view + CSV export
│
└─ 1.7 Auto-email invoices to admins   (#3)   [dep 1.1, 1.3, 1.5]
    ├─ 1.7a email template(s) — api/app/emails/templates/ + render.py
    ├─ 1.7b send on generation and/or monthly batch via ACS — acs_email.py
    └─ 1.7c super-admin trigger / broadcast so each company admin gets its own documents

EPIC 2 · Geography checkbox tree — Region→State→District→Pincode   (#8)
├─ 2.1 backend: district-per-state and pincode-per-district list endpoints (data exists:
│      territory.py Region/State/District/Pincode/PincodeDistrict) — geo/router.py + service.py
├─ 2.2 UI: cascading tri-state checkbox tree (select-all / indeterminate) — new, reuse ui/checkbox
├─ 2.3 replace chip MultiSelect in CoverageFields.tsx; expand selected leaves → technician_pincodes  [dep 2.1,2.2]
└─ 2.4 reuse in TechnicianFormDialog / invite / franchise portal  [dep 2.3]

EPIC 3 · Per-freelancer rules (full set) + min threshold + holding amount   (#9 #10)
├─ 3.1 data model: technician_rules — overrides (payout/bonus/penalty/speed/travel) +
│      min_redeemable_threshold_paise + holding_amount_paise — api/app/models/ + migration
├─ 3.2 extend rule resolution to a technician tier (DEFAULTS→company→node→franchisee×type→technician)
│      — api/app/core/rules.py  [dep 3.1]
├─ 3.3 payout/bonus/penalty/speed/travel honor per-tech overrides — core/ledger.py, speed_rules.py,
│      travel_rules.py  [dep 3.2]
├─ 3.4 redemption: enforce min threshold + subtract holding from redeemable — redemptions/service.py,
│      core/ledger.py  [dep 3.1]
├─ 3.5 manual holding set/release workflow (franchisee/admin)  [dep 3.1]
└─ 3.6 UI: per-technician rules panel — TechnicianFormDialog.tsx / tech detail  [dep 3.1]

EPIC 4 · Technician live location (active-job only)   (#12)
├─ 4.1 backend: location ingest endpoint + storage, gated to active/accepted jobs — jobs/ or technicians/
├─ 4.2 mobile: send coordinates while a job is active (expo-location, foreground)  [dep 4.1]
├─ 4.3 console live-map view (reuse BaseLocationMap / Leaflet), poll or WS  [dep 4.1]
└─ 4.4 scope: superadmin/admin/franchisee/vendor each see only permitted technicians  [dep 4.1]

EPIC 5 · Technician bank accounts (alongside UPI)   (#7)
├─ 5.1 data model: bank fields/table (bank_name, account_number, ifsc) — technician_profiles / new table + migration
├─ 5.2 validation (IFSC format, acct) + change governance (mirror upi_change.py if required)  [dep 5.1]
├─ 5.3 mobile profile UI to enter/edit (technician-owned)  [dep 5.1]
└─ 5.4 console display + payout-channel selection alongside UPI  [dep 5.1]

EPIC 6 · Spare-parts delivery address   (#11)
├─ 6.1 data model: delivery address per technician (default = base/home address) — technician_profiles + migration
├─ 6.2 wire into franchise parts flow (franchise/parts)  [dep 6.1]
└─ 6.3 UI: address field — mobile profile + console tech detail  [dep 6.1]

EPIC 7 · Local-area / post-office dropdown   (#17)
├─ 7.1 source + import India Post PIN→post-office dataset into a new post_offices table (repo already
│      has pincode CSVs at root) — reuse geo import pattern   [ASSUMPTION: we source it; user can supply]
├─ 7.2 backend: list post offices/localities per pincode — geo/router.py  [dep 7.1]
├─ 7.3 UI: local-area dropdown in AddressFields (raise ticket)  [dep 7.2]
└─ 7.4 (optional) expose in technician coverage  [dep 7.2]
```

### Suggested build sequence
1. **Epic 1** (money spine; largest, unblocks dashboards/statements/email).
2. Part A quick wins in parallel (A5, A6, A1, A2 — low risk, independent).
3. **Epic 3** (per-freelancer payouts) — touches the same ledger area as Epic 1, do after 1.1–1.3.
4. **Epic 2**, **Epic 5**, **Epic 6**, **Epic 7**, **Epic 4** — independent; schedule by priority.
5. Remaining Part A (A3+A4 together, A7, A8, A9).

### Cross-cutting rules (apply to every item)
- Money is **paise integers**, never floats; balances summed live, never stored.
- Every tenant table carries `company_id`; a guessed id returns **404**. Every new table → Alembic migration.
- Every list ships loading/empty/error states; forms use RHF + Zod + shared `Field*`/`FormSection`.
- New endpoints are gated by `require_*` guards in `api/app/core/deps.py` and mirrored in the nav/feature map.

### Default assumptions (flagged for correction)
- #6 priority is a single boolean (no SLA/routing impact).
- #8 "Amazon reference" = standard cascading tri-state checkbox tree.
- #14 serial autofill preserved; model still selected.
- #19 online/offline captured on the ticket at raise.
- #22 dedup via a per-ticket marker so it fires once.
- Epic 7 dataset will be sourced/imported by us unless the user provides it.

---

## Deliverable output & verification

- **Output file**: on approval, write this content to `installflow/RequirementDocs/CHANGE_REQUEST_BREAKDOWN.md`
  (single file, Part A checklist + Part B tree, as confirmed).
- **Verification of the deliverable** (it is a roadmap, not code):
  1. **Completeness** — the coverage matrix maps all **22** asks to a Part-A/Part-B item (no gaps).
  2. **Groundedness** — every named path (e.g. `api/app/features/tickets/sweeps.py`,
     `adminWeb/src/components/tickets/ManualEntryForm.tsx`, `api/app/core/vendor_credits.py`) exists
     in the repo; spot-check a handful.
  3. **Classification agreement** — Part A items are genuinely small/independent; Part B items carry
     cross-system/money/business-logic weight.
  4. **User review** — confirm the 6 default assumptions above.
- When implementation later begins, each Part-A item has its own "Done when …" check, and each Epic
  is verified end-to-end (run API on :8000 + adminWeb on :5173, drive the flow) per the repo's `verify` skill.
