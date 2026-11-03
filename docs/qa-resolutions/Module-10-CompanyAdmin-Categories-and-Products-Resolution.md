# Module 10 — Company Admin: Categories and Products — Resolution Sheet

Companion document to `Module-10-CompanyAdmin-Categories-and-Products.docx`
(QA: Sneha, execution 21–22 Oct 2026). Of the 8 logged defects, 6 are fixed
and 2 are confirmed intended behavior. Of the 3 open questions, 1 is resolved
as part of a defect fix and 2 are confirmed intended.

| ID | Title | Disposition |
|---|---|---|
| ADM-009 | Too-long product name gives a technical error | **Fixed** |
| ADM-008 | Technician payout can exceed the vendor price | **Confirmed intended — not a bug** |
| ADM-011 | A paused product has no marker | **Fixed** |
| ADM-010 | An empty spec row is silently dropped | **Confirmed intended — not a bug** |
| ADM-021 | Serial import takes a wrong heading, and a semicolon CSV, as data | **Fixed** |
| ADM-022 | Serials starting with `= + - @` are accepted as typed | **Fixed (rule widened)** |
| ADM-020 | Delete-serial question wrongly says "the last one" after a search | **Fixed** |
| ADM-026 | The same serial number can be added to two different products | **Fixed (rule widened to company-wide)** |
| OQ-A4 | Should payout be allowed to exceed vendor price? | Answered — allowed, see ADM-008 |
| OQ-A10 | "N sub-categories" vs "N products" counting differently | Confirmed intended — not a bug |
| OQ-A11 | Should a serial be unique per-product or globally? | Answered — globally, see ADM-026 |

---

## ADM-009 — Too-long product name gives a technical error

**Linked test:** CP-02 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** The product-name Zod schema
(`adminWeb/src/components/masters/categorySchema.ts:198`) only enforced
`.min(1, ...)`, with no upper bound, while the backend's `Name120`
(`api/app/features/masters/schemas.py:156`) caps it at 120 characters. A
301-character name passed client validation, reached the server, and came
back as the raw Pydantic message: *"Validation failed · name: String should
have at most 120 characters."*

**What changed.** Added `.max(120, "120 characters max")` to the same Zod
field, so the limit is caught and shown before the request is ever sent. No
backend change needed — the server-side limit was already correct; only the
client was missing it.

---

## ADM-008 — Technician payout can exceed the vendor price

**Linked test:** CP-04 · **Severity:** Low · **Disposition: Confirmed
intended — not a bug**

**Root cause.** `technicianPayoutPaise` and `vendorPricePaise` are validated
completely independently on both sides (`rupees()` in `categorySchema.ts:155`
client-side; `PricePaise` in `schemas.py:231` server-side) — there has never
been a check that one stays under the other.

**Disposition.** Confirmed by the product owner: a technician payout
exceeding the vendor price is an acceptable configuration (answers OQ-A4). No
code change made.

---

## ADM-011 — A paused product has no marker

**Linked tests:** CP-05, CT-14, PA-01, PA-07 · **Severity:** Low ·
**Disposition: Fixed**

**Root cause.** `StatusPill` (`adminWeb/src/components/masters/CategoryTree.tsx:104`)
— the same "Active"/"Paused" badge already shown on category rows
(`RootNode`, `ChildNode`) — was never wired to a product row (`ModelChip`).
A paused product showed only a strikethrough on its name, with no label
explaining why. Because the vendor's own "My products" page renders through
this same `CategoryTree`/`ModelChip` component, the gap also meant PA-07's
observation that a vendor "cannot tell why [a paused product] vanished" from
new ticket entry.

**What changed.** `ModelChip` now renders
`{model.isActive ? null : <StatusPill isActive={false} />}` next to the
product name, following the exact pattern already used for the approval
badge on the same chip. One change fixes both the admin Categories screen and
the vendor's "My products" page.

---

## ADM-010 — An empty spec row is silently dropped

**Linked test:** CP-08 · **Severity:** Low · **Disposition: Confirmed
intended — not a bug**

**Root cause.** `cleanParameters()` (`categorySchema.ts:257`) and the
backend's `_clean_parameters` (`schemas.py:103`) both silently drop a spec
row where the name is blank, by design — so a user who clicks "Add field" and
changes their mind is never forced to find the `×` to remove it. The form's
hint text ("every field needs a value") describes the rule for mandatory
fields, not for an untouched optional row.

**Disposition.** Confirmed: only fields marked `*` are mandatory. Optional
fields — including a spec row nobody filled in — may be saved empty, and are
simply never sent to the API. This already matches current behavior (the
same "omit when blank" pattern `capacity`/`notes`/`warrantyMonths` already
follow). No code change made.

---

## ADM-021 — Serial import takes a wrong heading, and a semicolon CSV, as data

**Linked tests:** SI-07, SI-12 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** Two separate gaps in `api/app/features/masters/service.py`:

1. `_iter_serial_rows`'s `.csv` branch called `csv.reader()` with no
   delimiter, defaulting to comma — a semicolon-separated file parsed as one
   column per line (the whole line, including the header, became a single
   "serial").
2. `import_serials`'s header-detection step treated *any* unrecognized first
   row as data the moment its text didn't match a known spelling
   (`_SERIAL_HEADERS`) — so `"Item Code"` was saved as a serial number
   outright.

**What changed.**
- `_iter_serial_rows` now sniffs the delimiter from the file's first line
  (`csv.Sniffer().sniff(first_line, delimiters=",;")`), falling back to comma
  only when sniffing fails (a genuinely single-column file). This alone fixes
  the semicolon case fully: once the line splits correctly, `"Serial Number"`
  normalizes to a recognized header and is skipped on its own.
- The header-row fallback now only treats an unrecognized first cell as data
  if it contains at least one digit — every real serial in this catalogue
  does, while a label like `"Item Code"` does not. A genuine headerless file
  of serials is still accepted exactly as before.

---

## ADM-022 — Serials starting with `= + - @` are accepted as typed

**Linked test:** SI-13 · **Severity:** Low · **Disposition: Fixed (rule
widened per clarification)**

**Root cause.** None of the three places a serial value is written — bulk
import's `take()`, manual add's `_clean_serials()`, manual edit's
`SerialUpdateRequest` — checked anything beyond the 64-character length cap,
so formula-triggering characters (`=1+1`, `@SUM(A1)`, `+cmd|...`) were stored
verbatim.

**Rule, as clarified:** a serial may contain **only** letters, digits (any
language) and the hyphen `-` — not just at the start, anywhere in the string.

**What changed.** Added one shared check in `schemas.py`,
`_has_disallowed_character()`, testing each character's **Unicode general
category** (`L` letter, `N` number, `M` mark) rather than `str.isalnum()`.
This distinction mattered: `isalnum()` is `False` for Devanagari vowel signs
and for a diacritic in NFD-decomposed accented Latin text, which would have
silently broken Hindi/accented-letter serials (SI-11's own requirement) had
it been used. Wired into all three write paths — bulk import (`take()`
rejects the row with a reason, same as any other reject), manual add
(`_clean_serials` raises), manual edit (`SerialUpdateRequest.serial` via an
`AfterValidator`).

**Known, flagged consequence:** this also now rejects emoji (Unicode category
Symbol), narrowing SI-11's previously-passing claim that an emoji saves
correctly. Hindi and accented letters remain accepted. This narrowing is the
clarified rule working as intended, not a regression.

---

## ADM-020 — Delete-serial question wrongly says "the last one" after a search

**Linked test:** SI-16 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** The delete-confirmation dialog
(`adminWeb/src/components/masters/ModelSerialsPanel.tsx`) decided "is this
the last serial" by checking `total === 1`, where `total` is the
**search-filtered** result count (`pagination.totalRecords` for whatever
search term is active) — not the model's real total. Filtering the list down
to one row made the dialog claim a serial was the model's last, even with 27
others hidden by the search.

**What changed.** `ModelSerialsPanel` now takes a `totalSerialCount` prop —
the model's real, unfiltered count, already available as `serialCount` on
the product object — and the "last one" condition checks that instead. The
filtered `total` is kept for the "N matching" display text, which it was
always correct for.

---

## ADM-026 — The same serial number can be added to two different products

**Linked test:** CT-13 · **Severity:** Low · **Disposition: Fixed (scope
widened to company-wide per clarification)**

**Root cause.** `product_model_serials`' uniqueness was scoped to
`(company_id, product_model_id, lower(serial))` — unique within one product
model, not across the catalogue — so the same physical serial could be
loaded onto two different products, including two different vendors'. At
ticket intake, a serial already present on the chosen model is still
accepted regardless of what else carries it, so the serial no longer
uniquely identified one unit.

**Rule, as clarified:** unique **company-wide**, across every product and
every vendor.

**What changed — four layers, in the order they need to ship:**

1. **Audit script** (new, read-only) —
   `api/app/scripts/audit_duplicate_serials.py` reports every serial
   currently shared by more than one product model in the same company, so
   any pre-existing duplicate can be cleaned by hand before the new
   constraint is applied. Must be run (and its findings resolved) against
   both the dev and prod databases before the migration below runs on each.
2. **Service-layer enforcement** (`api/app/features/masters/service.py`) —
   `_existing_lower()` now looks up ownership company-wide and returns which
   model owns each hit. `add_serials` and `import_serials` branch a clash
   into same-model (silent top-up, unchanged) vs. a different model (excluded
   and reported — `SerialAddResult.onOtherProduct` for the manual path, a
   named `SerialReject` reason for the import path). `update_serial`'s clash
   check widened the same way and names the other product in its 409.
3. **Ticket-intake consistency** (`api/app/features/tickets/service.py`,
   `import_service.py`) — `serial_owners()` (and its single-ticket and
   bulk-import callers) dropped its same-vendor-only filter so a different
   vendor's product carrying the serial is now also treated as a real
   catalogue clash at intake, not "unknown serial." Docstrings asserting the
   old per-vendor/per-model rule (including the line "a serial may legally
   sit on two products") were rewritten to match.
4. **Schema migration** (new revision `d4f8a21b9c56`) — drops
   `uq_product_model_serials_model_serial_lower` and replaces it with
   `uq_product_model_serials_company_serial_lower (company_id, lower(serial))`,
   adding a non-unique index on the old three columns so per-model lookups
   stay cheap. Comments in `product.py` and the two earlier migrations
   (`b5e9c412d80a`, `c7f1a4e93b26`) that documented the old per-model
   rationale were rewritten so no comment in the codebase still argues
   against the rule now in force.

**Not done in this pass, by design:** the migration has **not been run**
against any database (dev or prod) — that is a manual step for the owner,
after running the audit script and resolving whatever it finds. The service
code above works correctly with or without the new index in place (its own
detection is a query, not a constraint), so the application-level protection
is already live; the migration adds the database-level guarantee on top.

---

## OQ-A4 — Should payout be allowed to exceed vendor price?

Answered: yes. See **ADM-008** above — confirmed intended, no restriction
added.

## OQ-A10 — "N sub-categories" counts direct children, "N products" counts every descendant

Confirmed intended, not a bug. Both counts are correct for what each is
defined to mean — sub-category count answers "what's one level down,"
product count answers "how much work is really under this branch." No code
change made.

## OQ-A11 — Should a serial be unique per-product or globally?

Answered: globally, across every product and vendor in the company. See
**ADM-026** above.

---

## Verification performed

- `adminWeb`: `npx tsc --noEmit` (clean) and `eslint` (clean) across every
  touched file.
- `api`: all touched/new modules import cleanly
  (`app.features.masters.service`, `app.features.masters.schemas`,
  `app.features.tickets.service`, `app.features.tickets.import_service`,
  `app.models.product`, `app.scripts.audit_duplicate_serials`); full
  `pytest` suite (unit, no database) passes with no failures.
- The new migration's DDL was compiled against the Postgres dialect (no
  database connection) to confirm the functional index syntax is valid, and
  `alembic heads` confirms it chains correctly as the sole head.
- The migration itself was **not executed** against any database in this
  pass — see ADM-026's note above.

## Not run (manual steps remaining)

- `python -m app.scripts.audit_duplicate_serials` against the dev database,
  and against production, resolving anything it reports.
- `alembic upgrade head` on the dev database (`RelianceDB`) first, with the
  upgrade → downgrade → upgrade round trip tested, then on production
  (`RelianceProdDB`, with `CONFIRM_PROD` set) only after the audit is clean
  there too.
- Manual re-run of the originally-affected QA steps (CP-02, CT-14/PA-01/PA-07,
  SI-16, SI-07/SI-12, SI-13, CT-13) against a live environment, to close the
  loop with the original bug report.
